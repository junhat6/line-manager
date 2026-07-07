import type { messagingApi } from "@line/bot-sdk";
import { and, eq, inArray } from "drizzle-orm";
import type { MessageKind } from "@/contracts/messages";
import type { Db } from "@/db/client";
import {
  lineGroups,
  scheduledMessages,
  sessions,
  type ScheduledMessage,
  type Session,
} from "@/db/schema";
import { formatJstDateLabel, formatJstTime } from "@/lib/jst";
import { pushMessages } from "@/lib/line/client";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import {
  buildDayBeforeMessages,
  buildDayOfMessages,
  buildGroupInviteMessages,
  buildSlideRequestMessages,
  buildSurveyMessages,
} from "@/lib/templates";

export type SendFn = (
  to: string,
  messages: messagingApi.Message[],
  channel: number,
) => Promise<void>;

export type SendResult = {
  id: string;
  kind: MessageKind;
  ok: boolean;
  error?: string;
};

export type BuiltMessage = {
  to: string;
  channel: number;
  messages: messagingApi.Message[];
};

/**
 * scheduled_messages の1行を送信する。
 * 先に status を sending へ原子的に更新(claim)してから送るため、
 * cron の tick と管理画面のボタンが同時に走っても二重送信にならない。
 * claim できなかった(=処理済み/処理中)場合は null を返す。
 */
export async function sendScheduledMessage(
  db: Db,
  id: string,
  opts: { force?: boolean; send?: SendFn } = {},
): Promise<SendResult | null> {
  // force は送信済みメッセージの意図的な再送(管理画面で確認ダイアログ付き)
  const claimable = opts.force
    ? (["pending", "failed", "sent"] as const)
    : (["pending", "failed"] as const);

  const claimed = await db
    .update(scheduledMessages)
    .set({ status: "sending", claimedAt: new Date() })
    .where(
      and(
        eq(scheduledMessages.id, id),
        inArray(scheduledMessages.status, [...claimable]),
      ),
    )
    .returning();
  const row = claimed[0];
  if (!row) return null;

  try {
    const built = await buildScheduledMessage(db, row);
    await (opts.send ?? pushMessages)(built.to, built.messages, built.channel);
    await db
      .update(scheduledMessages)
      .set({ status: "sent", sentAt: new Date(), error: null })
      .where(eq(scheduledMessages.id, id));
    return { id, kind: row.kind, ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .update(scheduledMessages)
      .set({ status: "failed", error: message })
      .where(eq(scheduledMessages.id, id));
    return { id, kind: row.kind, ok: false, error: message };
  }
}

/**
 * 行の kind に応じて宛先とメッセージを組み立てる。
 * 前提が欠けている場合(グループ未紐付け・URL未設定など)は例外を投げ、
 * 呼び出し側で failed として記録されてチェックリストに理由が表示される —
 * 黙って欠けた内容を送るより「送れていない」が見えるほうが抜け漏れ防止になる。
 */
export async function buildScheduledMessage(
  db: Db,
  row: ScheduledMessage,
): Promise<BuiltMessage> {
  switch (row.kind) {
    case "group_invite": {
      const session = await requireSession(db, row);
      const target = await requireMainGroup(db);
      if (!session.inviteLink) {
        throw new Error(
          "グループの招待リンクが未設定です(日程の編集フォームで入力してください)",
        );
      }
      return {
        ...target,
        messages: buildGroupInviteMessages({
          dateLabel: formatJstDateLabel(session.startAt),
          inviteLink: session.inviteLink,
        }),
      };
    }
    case "slide_request": {
      const session = await requireSession(db, row);
      return {
        ...(await requireSessionGroup(db, session)),
        messages: buildSlideRequestMessages({
          dateLabel: formatJstDateLabel(session.startAt),
          slideUrl: requireSlideUrl(session),
        }),
      };
    }
    case "day_before": {
      const session = await requireSession(db, row);
      return {
        ...(await requireSessionGroup(db, session)),
        messages: buildDayBeforeMessages({
          dateLabel: formatJstDateLabel(session.startAt),
          startTime: formatJstTime(session.startAt),
          slideUrl: requireSlideUrl(session),
        }),
      };
    }
    case "day_of": {
      const session = await requireSession(db, row);
      if (!session.meetingInfo) {
        throw new Error(
          "参加方法が未設定です(日程の編集フォームで入力してください)",
        );
      }
      return {
        ...(await requireSessionGroup(db, session)),
        messages: buildDayOfMessages({
          dateLabel: formatJstDateLabel(session.startAt),
          startTime: formatJstTime(session.startAt),
          meetingInfo: session.meetingInfo,
          slideUrl: requireSlideUrl(session),
          dayFlow: session.dayFlow,
        }),
      };
    }
    case "survey": {
      const session = await requireSession(db, row);
      return {
        ...(await requireSessionGroup(db, session)),
        messages: buildSurveyMessages({
          firstTimeUrl: await getSetting(db, SETTING_KEYS.surveyUrlFirst),
          repeatUrl: await getSetting(db, SETTING_KEYS.surveyUrlRepeat),
        }),
      };
    }
  }
}

/** 宛先グループとそのグループを担当するLINEチャネル */
export type GroupTarget = { to: string; channel: number };

/** メイングループの宛先とチャネル。日程調整URLの投稿(actions)でも使う */
export async function requireMainGroup(db: Db): Promise<GroupTarget> {
  const rows = await db
    .select({
      lineGroupId: lineGroups.lineGroupId,
      channel: lineGroups.channel,
    })
    .from(lineGroups)
    .where(and(eq(lineGroups.kind, "main"), eq(lineGroups.active, true)));
  const main = rows[0];
  if (!main) {
    throw new Error(
      "メイングループが未設定です(グループ画面で「メイン」に設定してください)",
    );
  }
  return { to: main.lineGroupId, channel: main.channel };
}

async function requireSession(db: Db, row: ScheduledMessage): Promise<Session> {
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, row.sessionId));
  const session = rows[0];
  if (!session) throw new Error("日程が見つかりません");
  return session;
}

/**
 * 日程別グループの宛先とチャネルを解決する。
 * チャネルは sessions にコピーせず lineGroups を毎回引く —
 * ボット入れ替え(旧退出→新招待)時に、紐付けを触らなくても自動で追従させるため。
 */
async function requireSessionGroup(
  db: Db,
  session: Session,
): Promise<GroupTarget> {
  if (!session.lineGroupId) {
    throw new Error(
      "日程別LINEグループが未紐付けです(グループにボットを招待して、イベント詳細で紐付けてください)",
    );
  }
  const rows = await db
    .select()
    .from(lineGroups)
    .where(eq(lineGroups.lineGroupId, session.lineGroupId));
  const group = rows[0];
  if (!group) {
    throw new Error(
      "日程別LINEグループがグループ一覧に見つかりません(ボットを招待し直してください)",
    );
  }
  if (!group.active) {
    throw new Error(
      "ボットが日程別LINEグループから退出しています(招待し直してください)",
    );
  }
  return { to: group.lineGroupId, channel: group.channel };
}

function requireSlideUrl(session: Session): string {
  if (!session.slideUrl) {
    throw new Error(
      "自己紹介スライドURLが未設定です(日程の編集フォームで入力してください)",
    );
  }
  return session.slideUrl;
}
