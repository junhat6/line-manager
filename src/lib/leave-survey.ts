/**
 * 日程別グループを開催前に退会した人へのキャンセル理由ヒアリング。
 *
 * memberLeft webhookから呼ばれ、次の順で処理する:
 *   1. 退会したグループが日程(sessions)に紐づき、かつ退会が開催前ならキャンセル扱い
 *   2. キャンセル理由フォームのURLをDMでpush
 *   3. DMを送れなかった場合(友だち未追加が典型)はSlackへ通知して運営の個別確認に委ねる
 *
 * 開催後の退会(交流会が終わってグループを整理しただけ)は正常な離脱なので何もしない。
 */
import { HTTPFetchError } from "@line/bot-sdk";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { events, lineGroupMembers, lineGroups, sessions } from "@/db/schema";
import { formatJstDateLabel, formatJstDateTimeLabel } from "@/lib/jst";
import { pushMessages } from "@/lib/line/client";
import type { SendFn } from "@/lib/send";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { postSlackMessage } from "@/lib/slack";
import { buildLeaveSurveyMessages } from "@/lib/templates";

// ---------- 純粋ロジック(テスト対象) ----------

/**
 * 退会が「開催前のキャンセル」にあたる日程を選ぶ。
 * 退会時刻より後に始まる日程がなければnull(=日程別グループでない、
 * もしくは開催後の退会)。複数該当する場合は直近の日程を採る。
 * 開始時刻ちょうど・開催中の退会もキャンセルとは扱わない(>で比較)。
 */
export function pickCancelledSession<T extends { startAt: Date }>(
  rows: T[],
  leftAt: Date,
): T | null {
  const upcoming = rows.filter((r) => r.startAt.getTime() > leftAt.getTime());
  if (upcoming.length === 0) return null;
  return upcoming.reduce((a, b) => (a.startAt <= b.startAt ? a : b));
}

export type MemberLeftSlackInput = {
  /** 参加時に記録した表示名。記録がなければnull */
  displayName: string | null;
  lineUserId: string;
  groupName: string | null;
  eventTitle: string;
  /** 例: "7/22(火) 19:00" */
  sessionLabel: string;
  /** DMを送れなかった理由 */
  dmFailure: string;
};

/** DMを送れなかった退会者のSlack通知本文。運営が個別に連絡するための情報を集約する */
export function buildMemberLeftSlackText(input: MemberLeftSlackInput): string {
  const member = input.displayName
    ? `${input.displayName} (${input.lineUserId})`
    : `表示名の記録なし (${input.lineUserId})`;
  return [
    "👋 開催前の日程別グループ退会(キャンセルの可能性)を検知しました",
    "",
    `日程: ${input.eventTitle} ${input.sessionLabel}`,
    `グループ: ${input.groupName ?? "(名前不明)"}`,
    `メンバー: ${member}`,
    "",
    `キャンセル理由のDMを送れませんでした: ${input.dmFailure}`,
    "お手数ですが、個別に理由の確認をお願いします🙏",
  ].join("\n");
}

/** SDKの例外はmessageに詳細が入らないことがあるため、レスポンスボディも添える */
function describeSendError(e: unknown): string {
  if (e instanceof HTTPFetchError) {
    return `HTTP ${e.status} ${e.body}`.trim();
  }
  return e instanceof Error ? e.message : String(e);
}

// ---------- I/O ----------

export type MemberLeftInput = {
  lineGroupId: string;
  /** 退会したユーザーのID一覧(webhookのleft.membersから) */
  userIds: string[];
  /** LINEがwebhookイベントに載せてくる発生時刻 */
  leftAt: Date;
  /** そのグループを担当するボットのチャネル(webhookが届いたチャネル) */
  channel: number;
};

export type ProcessMemberLeftDeps = {
  send?: SendFn;
  notifySlack?: (text: string) => Promise<void>;
};

export async function processMemberLeft(
  db: Db,
  input: MemberLeftInput,
  deps: ProcessMemberLeftDeps = {},
): Promise<void> {
  const send = deps.send ?? pushMessages;
  const notifySlack = deps.notifySlack ?? postSlackMessage;

  // 退会の記録はキャンセル判定と無関係に残す(メイングループや開催後の退会も含む)
  await db
    .update(lineGroupMembers)
    .set({ leftAt: input.leftAt })
    .where(
      and(
        eq(lineGroupMembers.lineGroupId, input.lineGroupId),
        inArray(lineGroupMembers.lineUserId, input.userIds),
      ),
    );

  const sessionRows = await db
    .select({ startAt: sessions.startAt, eventTitle: events.title })
    .from(sessions)
    .innerJoin(events, eq(sessions.eventId, events.id))
    .where(eq(sessions.lineGroupId, input.lineGroupId));
  const cancelled = pickCancelledSession(sessionRows, input.leftAt);
  if (!cancelled) return;

  const groupRows = await db
    .select({ name: lineGroups.name })
    .from(lineGroups)
    .where(eq(lineGroups.lineGroupId, input.lineGroupId));
  const groupName = groupRows[0]?.name ?? null;
  const formUrl = (await getSetting(db, SETTING_KEYS.leaveSurveyUrl)).trim();
  const sessionLabel = formatJstDateTimeLabel(cancelled.startAt);

  for (const userId of input.userIds) {
    // 1人への通知失敗で残りの退会者の処理を止めない(webhookは再配送されないため)
    try {
      let dmFailure: string | null = null;
      if (!formUrl) {
        dmFailure =
          "キャンセル理由フォームのURLが未設定です(設定画面で入力してください)";
      } else {
        try {
          await send(
            userId,
            buildLeaveSurveyMessages({
              dateLabel: formatJstDateLabel(cancelled.startAt),
              formUrl,
            }),
            input.channel,
          );
        } catch (e) {
          dmFailure = describeSendError(e);
        }
      }
      if (dmFailure === null) continue;

      const memberRows = await db
        .select({ displayName: lineGroupMembers.displayName })
        .from(lineGroupMembers)
        .where(
          and(
            eq(lineGroupMembers.lineGroupId, input.lineGroupId),
            eq(lineGroupMembers.lineUserId, userId),
          ),
        );
      await notifySlack(
        buildMemberLeftSlackText({
          displayName: memberRows[0]?.displayName ?? null,
          lineUserId: userId,
          groupName,
          eventTitle: cancelled.eventTitle,
          sessionLabel,
          dmFailure,
        }),
      );
    } catch (e) {
      console.error("member left handling failed", userId, e);
    }
  }
}
