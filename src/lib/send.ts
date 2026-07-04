import type { messagingApi } from "@line/bot-sdk";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { MessageKind } from "@/contracts/messages";
import type { Db } from "@/db/client";
import {
  events,
  lineGroups,
  scheduledMessages,
  sessions,
  type ScheduledMessage,
  type Session,
} from "@/db/schema";
import {
  formatJstDateLabel,
  formatJstDateTimeLabel,
  formatJstTime,
} from "@/lib/jst";
import { pushMessages } from "@/lib/line/client";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import {
  buildAnnounceMessages,
  buildDayBeforeMessages,
  buildDayOfMessages,
  buildGroupInviteMessages,
  buildSlideRequestMessages,
  buildSurveyMessages,
} from "@/lib/templates";

export type SendFn = (
  to: string,
  messages: messagingApi.Message[],
) => Promise<void>;

export type SendResult = {
  id: string;
  kind: MessageKind;
  ok: boolean;
  error?: string;
};

export type BuiltMessage = { to: string; messages: messagingApi.Message[] };

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
    await (opts.send ?? pushMessages)(built.to, built.messages);
    await db
      .update(scheduledMessages)
      .set({ status: "sent", sentAt: new Date(), error: null })
      .where(eq(scheduledMessages.id, id));

    if (row.kind === "announce") {
      await db
        .update(events)
        .set({ status: "announced" })
        .where(and(eq(events.id, row.eventId), eq(events.status, "draft")));
    }
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
    case "announce": {
      const to = await requireMainGroupId(db);
      const eventRows = await db
        .select()
        .from(events)
        .where(eq(events.id, row.eventId));
      const event = eventRows[0];
      if (!event) throw new Error("イベントが見つかりません");
      const sessionRows = await db
        .select()
        .from(sessions)
        .where(eq(sessions.eventId, row.eventId))
        .orderBy(asc(sessions.startAt));
      if (sessionRows.length === 0) {
        throw new Error("日程が登録されていません");
      }
      return {
        to,
        messages: buildAnnounceMessages({
          eventTitle: event.title,
          sessions: sessionRows.map((s) => ({
            sessionId: s.id,
            label: formatJstDateTimeLabel(s.startAt),
          })),
        }),
      };
    }
    case "group_invite": {
      const session = await requireSession(db, row);
      const to = await requireMainGroupId(db);
      if (!session.inviteLink) {
        throw new Error(
          "グループの招待リンクが未設定です(日程の編集フォームで入力してください)",
        );
      }
      return {
        to,
        messages: buildGroupInviteMessages({
          dateLabel: formatJstDateLabel(session.startAt),
          inviteLink: session.inviteLink,
        }),
      };
    }
    case "slide_request": {
      const session = await requireSession(db, row);
      return {
        to: requireSessionGroup(session),
        messages: buildSlideRequestMessages({
          dateLabel: formatJstDateLabel(session.startAt),
          slideUrl: requireSlideUrl(session),
        }),
      };
    }
    case "day_before": {
      const session = await requireSession(db, row);
      return {
        to: requireSessionGroup(session),
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
        to: requireSessionGroup(session),
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
        to: requireSessionGroup(session),
        messages: buildSurveyMessages({
          firstTimeUrl: await getSetting(db, SETTING_KEYS.surveyUrlFirst),
          repeatUrl: await getSetting(db, SETTING_KEYS.surveyUrlRepeat),
        }),
      };
    }
  }
}

async function requireMainGroupId(db: Db): Promise<string> {
  const rows = await db
    .select({ lineGroupId: lineGroups.lineGroupId })
    .from(lineGroups)
    .where(and(eq(lineGroups.kind, "main"), eq(lineGroups.active, true)));
  const main = rows[0];
  if (!main) {
    throw new Error(
      "メイングループが未設定です(グループ画面で「メイン」に設定してください)",
    );
  }
  return main.lineGroupId;
}

async function requireSession(db: Db, row: ScheduledMessage): Promise<Session> {
  if (!row.sessionId) throw new Error("日程が紐づいていません");
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, row.sessionId));
  const session = rows[0];
  if (!session) throw new Error("日程が見つかりません");
  return session;
}

function requireSessionGroup(session: Session): string {
  if (!session.lineGroupId) {
    throw new Error(
      "日程別LINEグループが未紐付けです(グループにボットを招待して、イベント詳細で紐付けてください)",
    );
  }
  return session.lineGroupId;
}

function requireSlideUrl(session: Session): string {
  if (!session.slideUrl) {
    throw new Error(
      "自己紹介スライドURLが未設定です(日程の編集フォームで入力してください)",
    );
  }
  return session.slideUrl;
}
