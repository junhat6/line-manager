"use server";

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createEventSchema,
  saveSettingsSchema,
  startSchedulePollSchema,
  updateSessionSchema,
  type ActionResult,
} from "@/contracts/forms";
import { getDb, type Db } from "@/db/client";
import {
  attendances,
  events,
  lineGroups,
  members,
  schedulePolls,
  scheduledMessages,
  sessions,
  type SchedulePoll,
} from "@/db/schema";
import {
  buildMonthCandidates,
  createChouseisanEvent,
  fetchChouseisanCsv,
  nextMonthStart,
  parseChouseisanCsv,
  rankCandidates,
} from "@/lib/chouseisan";
import {
  dayBeforeAt15,
  dayOfAt9,
  defaultSurveyAt,
  jstToUtc,
  parseJstFromInput,
  toJstParts,
} from "@/lib/jst";
import { pushMessages } from "@/lib/line/client";
import { resolveScheduledAt } from "@/lib/reschedule";
import { requireMainGroup, sendScheduledMessage } from "@/lib/send";
import { SETTING_KEYS, setSetting } from "@/lib/settings";
import { buildPollUrlMessages, defaultPollMessageBody } from "@/lib/templates";

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

/** 例外をトースト表示用のActionResultに変換する(ZodErrorは先頭メッセージを出す) */
function failure(e: unknown): ActionResult {
  if (e instanceof z.ZodError) {
    return {
      ok: false,
      message: e.issues[0]?.message ?? "入力内容を確認してください",
    };
  }
  console.error(e);
  return {
    ok: false,
    message: e instanceof Error ? e.message : "エラーが発生しました",
  };
}

export async function createEvent(formData: FormData): Promise<ActionResult> {
  let eventId: string;
  try {
    const sessionInputs: { startAt: Date }[] = [];
    for (const i of [1, 2]) {
      const date = text(formData, `date${i}`).trim();
      const time = text(formData, `time${i}`).trim();
      if (!date && !time) continue;
      if (!date || !time) {
        return {
          ok: false,
          message: `日程${i}は日付と時刻の両方を入力してください`,
        };
      }
      sessionInputs.push({ startAt: parseJstFromInput(`${date}T${time}`) });
    }

    const input = createEventSchema.parse({
      title: text(formData, "title"),
      sessions: sessionInputs,
    });

    const event = await createEventWithSessions(
      getDb(),
      input.title,
      input.sessions.map((s) => s.startAt),
    );
    eventId = event.id;
  } catch (e) {
    return failure(e);
  }
  // redirectは内部でthrowするため、failure()に飲み込まれないようtryの外に置く
  redirect(`/events/${eventId}`);
}

/**
 * イベント + 日程 + チェックリスト(=送信キュー)を一括作成する。
 * 「何を送るべきか」が最初から全部見えることが抜け漏れ防止の core なので、
 * 後から行を足す方式にはしない。フォームからの作成と日程調整の取込の共通処理。
 */
async function createEventWithSessions(
  db: Db,
  title: string,
  startAts: Date[],
): Promise<{ id: string }> {
  const [event] = await db.insert(events).values({ title }).returning();

  const smValues: (typeof scheduledMessages.$inferInsert)[] = [
    { eventId: event.id, sessionId: null, kind: "announce", scheduledAt: null },
  ];
  for (const startAt of startAts) {
    const [session] = await db
      .insert(sessions)
      .values({ eventId: event.id, startAt })
      .returning();
    smValues.push(
      {
        eventId: event.id,
        sessionId: session.id,
        kind: "group_invite",
        scheduledAt: null,
      },
      {
        eventId: event.id,
        sessionId: session.id,
        kind: "slide_request",
        scheduledAt: null,
      },
      {
        eventId: event.id,
        sessionId: session.id,
        kind: "day_before",
        scheduledAt: dayBeforeAt15(startAt),
      },
      {
        eventId: event.id,
        sessionId: session.id,
        kind: "day_of",
        scheduledAt: dayOfAt9(startAt),
      },
      {
        eventId: event.id,
        sessionId: session.id,
        kind: "survey",
        scheduledAt: defaultSurveyAt(startAt),
      },
    );
  }
  await db.insert(scheduledMessages).values(smValues);
  return event;
}

export async function updateSession(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const optionalAt = (key: string): Date | null => {
      const raw = text(formData, key).trim();
      return raw ? parseJstFromInput(raw) : null;
    };
    const input = updateSessionSchema.parse({
      sessionId: text(formData, "sessionId"),
      eventId: text(formData, "eventId"),
      startAt: parseJstFromInput(text(formData, "startAt")),
      lineGroupId: text(formData, "lineGroupId"),
      inviteLink: text(formData, "inviteLink"),
      slideUrl: text(formData, "slideUrl"),
      meetingInfo: text(formData, "meetingInfo"),
      dayFlow: text(formData, "dayFlow"),
      dayBeforeAt: optionalAt("dayBeforeAt"),
      dayOfAt: optionalAt("dayOfAt"),
      surveyAt: optionalAt("surveyAt"),
    });

    const db = getDb();
    // 開催日時の変更量(追従計算)と「フォーム値をユーザーが触ったか」の
    // 判別のため、更新前の値を先に読む
    const currentRows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, input.sessionId));
    const current = currentRows[0];
    if (!current) return { ok: false, message: "日程が見つかりません" };
    const smRows = await db
      .select()
      .from(scheduledMessages)
      .where(eq(scheduledMessages.sessionId, input.sessionId));

    await db
      .update(sessions)
      .set({
        startAt: input.startAt,
        lineGroupId: input.lineGroupId,
        inviteLink: input.inviteLink,
        slideUrl: input.slideUrl,
        meetingInfo: input.meetingInfo,
        dayFlow: input.dayFlow,
      })
      .where(eq(sessions.id, input.sessionId));

    // 予約時刻の更新。カスタマイズ値は尊重し、触っていない値は開催日時の
    // 変更に追従させる(判断はresolveScheduledAt)。failed行もpendingに戻して
    // 再アームする(URL未設定などで失敗した後、設定を直せば次のtickで自動送信
    // されるように)。送信済み(sent)は履歴なので触らない。
    const shiftMs = input.startAt.getTime() - current.startAt.getTime();
    const reschedule = async (
      kind: "day_before" | "day_of" | "survey",
      formValue: Date | null,
    ) => {
      const row = smRows.find((r) => r.kind === kind);
      const scheduledAt = resolveScheduledAt(
        formValue,
        row?.scheduledAt ?? null,
        shiftMs,
      );
      if (!scheduledAt) return;
      await db
        .update(scheduledMessages)
        .set({ scheduledAt, status: "pending", error: null })
        .where(
          and(
            eq(scheduledMessages.sessionId, input.sessionId),
            eq(scheduledMessages.kind, kind),
            inArray(scheduledMessages.status, ["pending", "failed"]),
          ),
        );
    };
    await reschedule("day_before", input.dayBeforeAt);
    await reschedule("day_of", input.dayOfAt);
    await reschedule("survey", input.surveyAt);

    revalidatePath(`/events/${input.eventId}`);
    return { ok: true, message: "保存しました" };
  } catch (e) {
    return failure(e);
  }
}

export async function sendMessageAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const id = z.uuid().parse(text(formData, "id"));
    const eventId = z.uuid().parse(text(formData, "eventId"));
    const force = text(formData, "force") === "1";

    // 失敗は scheduled_messages.error にも記録され、チェックリストに表示される
    const result = await sendScheduledMessage(getDb(), id, { force });

    revalidatePath(`/events/${eventId}`);
    if (!result) {
      return {
        ok: false,
        message: "対象が見つかりません(すでに処理中の可能性があります)",
      };
    }
    if (!result.ok) {
      return { ok: false, message: result.error ?? "送信に失敗しました" };
    }
    return { ok: true, message: "送信しました" };
  } catch (e) {
    return failure(e);
  }
}

export async function addManualAttendee(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const sessionId = z.uuid().parse(text(formData, "sessionId"));
    const eventId = z.uuid().parse(text(formData, "eventId"));
    const name = z
      .string()
      .trim()
      .min(1, "名前を入力してください")
      .parse(text(formData, "name"));

    const db = getDb();
    // 口頭・チャット外で参加表明した人向け。LINEユーザーと紐づかないので専用IDを振る
    const [member] = await db
      .insert(members)
      .values({ lineUserId: `manual:${randomUUID()}`, displayName: name })
      .returning();
    await db
      .insert(attendances)
      .values({ sessionId, memberId: member.id, source: "manual" });

    revalidatePath(`/events/${eventId}`);
    return { ok: true, message: `${name} さんを追加しました` };
  } catch (e) {
    return failure(e);
  }
}

export async function removeAttendance(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const attendanceId = z.uuid().parse(text(formData, "attendanceId"));
    const eventId = z.uuid().parse(text(formData, "eventId"));

    const db = getDb();
    const removed = await db
      .delete(attendances)
      .where(eq(attendances.id, attendanceId))
      .returning({ memberId: attendances.memberId });

    // 手動追加のメンバーは参加記録以外に存在意義がないので一緒に消す
    const memberId = removed[0]?.memberId;
    if (memberId) {
      const rows = await db
        .select({ lineUserId: members.lineUserId })
        .from(members)
        .where(eq(members.id, memberId));
      if (rows[0]?.lineUserId.startsWith("manual:")) {
        await db.delete(members).where(eq(members.id, memberId));
      }
    }

    revalidatePath(`/events/${eventId}`);
    return { ok: true, message: "参加者から外しました" };
  } catch (e) {
    return failure(e);
  }
}

export async function markEventDone(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const eventId = z.uuid().parse(text(formData, "eventId"));
    await getDb()
      .update(events)
      .set({ status: "done" })
      .where(eq(events.id, eventId));
    revalidatePath(`/events/${eventId}`);
    revalidatePath("/");
    return { ok: true, message: "イベントを完了にしました" };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteEvent(formData: FormData): Promise<void> {
  const eventId = z.uuid().parse(text(formData, "eventId"));
  await getDb().delete(events).where(eq(events.id, eventId));
  redirect("/");
}

export async function setGroupKind(formData: FormData): Promise<ActionResult> {
  try {
    const id = z.uuid().parse(text(formData, "id"));
    const kind = z
      .enum(["main", "session", "unknown"])
      .parse(text(formData, "kind"));

    const db = getDb();
    // メイングループは常に1つ。新しくmainにしたら既存のmainを外す
    if (kind === "main") {
      await db
        .update(lineGroups)
        .set({ kind: "unknown" })
        .where(eq(lineGroups.kind, "main"));
    }
    await db.update(lineGroups).set({ kind }).where(eq(lineGroups.id, id));

    revalidatePath("/groups");
    revalidatePath("/settings");
    return { ok: true, message: "役割を変更しました" };
  } catch (e) {
    return failure(e);
  }
}

/** 日程調整の開催時刻のデフォルト(イベント作成フォームの初期値と同じ。取込後に日程カードで変更可能) */
const DEFAULT_SESSION_HOUR = 19;

/**
 * 来月分の日程調整を開始する:
 * 調整さんに来月全日程を候補にしたイベントを作成し、URLをメイングループに投稿する。
 * 投稿本文はフォームで編集でき、再投稿でも同じ本文を使うため行に保存する。
 */
export async function startSchedulePoll(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const input = startSchedulePollSchema.parse({
      message: text(formData, "message"),
    });

    const db = getDb();
    const targetMonth = nextMonthStart(new Date());
    const month = toJstParts(targetMonth).month;
    const title = `${month}月交流会 日程調整`;

    const { url } = await createChouseisanEvent({
      title,
      comment:
        "参加できる日に◯、調整すれば参加できる日に△、難しい日に×をお願いします!",
      candidates: buildMonthCandidates(targetMonth),
    });

    const [poll] = await db
      .insert(schedulePolls)
      .values({ title, chouseisanUrl: url, targetMonth, message: input.message })
      .returning();

    // URL投稿に失敗しても調整さんイベント自体は作成済みなので、行は残して
    // 「再投稿」ボタンでリカバリできるようにする(投稿済みかは postedAt で見える)
    try {
      await postPollUrlToMainGroup(db, poll);
    } catch (e) {
      console.error("schedule poll URL post failed", poll.id, e);
      revalidatePath("/polls");
      return {
        ok: false,
        message:
          "日程調整は作成しましたが、グループへのURL投稿に失敗しました。「グループに投稿する」から再試行してください",
      };
    }

    revalidatePath("/polls");
    return { ok: true, message: "日程調整を作成し、グループに投稿しました" };
  } catch (e) {
    return failure(e);
  }
}

/** 日程調整URLのメイングループへの(再)投稿 */
export async function postSchedulePollUrl(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const id = z.uuid().parse(text(formData, "id"));
    const db = getDb();
    const [poll] = await db
      .select()
      .from(schedulePolls)
      .where(eq(schedulePolls.id, id));
    if (!poll) return { ok: false, message: "日程調整が見つかりません" };

    await postPollUrlToMainGroup(db, poll);
    revalidatePath("/polls");
    return { ok: true, message: "グループに投稿しました" };
  } catch (e) {
    return failure(e);
  }
}

async function postPollUrlToMainGroup(
  db: Db,
  poll: SchedulePoll,
): Promise<void> {
  const target = await requireMainGroup(db);
  const month = toJstParts(poll.targetMonth).month;
  await pushMessages(
    target.to,
    buildPollUrlMessages({
      body: poll.message ?? defaultPollMessageBody(month),
      url: poll.chouseisanUrl,
    }),
    target.channel,
  );
  await db
    .update(schedulePolls)
    .set({ postedAt: new Date() })
    .where(eq(schedulePolls.id, poll.id));
}

/**
 * 調整さんの回答を集計し、上位2日程(◯=1点・△=0.5点、同点は早い日付優先)で
 * イベントを自動作成する。
 */
export async function importSchedulePoll(
  formData: FormData,
): Promise<ActionResult> {
  let eventId: string;
  try {
    const id = z.uuid().parse(text(formData, "id"));
    const db = getDb();
    const [poll] = await db
      .select()
      .from(schedulePolls)
      .where(eq(schedulePolls.id, id));
    if (!poll) return { ok: false, message: "日程調整が見つかりません" };

    if (poll.status === "imported" && poll.importedEventId) {
      eventId = poll.importedEventId;
    } else {
      const csv = await fetchChouseisanCsv(poll.chouseisanUrl);
      const ranked = rankCandidates(parseChouseisanCsv(csv, poll.targetMonth));
      if (ranked.length === 0) {
        return {
          ok: false,
          message:
            "集計できる候補が見つかりません(調整さんのページ構成が変わった可能性があります)",
        };
      }
      if (ranked[0].score <= 0) {
        return {
          ok: false,
          message:
            "まだ回答がありません(全候補0点)。回答が集まってから取り込んでください",
        };
      }

      const startAts = ranked
        .slice(0, 2)
        .map((c) => {
          const p = toJstParts(c.date);
          return jstToUtc(p.year, p.month, p.day, DEFAULT_SESSION_HOUR, 0);
        })
        .sort((a, b) => a.getTime() - b.getTime());

      const month = toJstParts(poll.targetMonth).month;
      const event = await createEventWithSessions(
        db,
        `${month}月交流会`,
        startAts,
      );
      await db
        .update(schedulePolls)
        .set({ status: "imported", importedEventId: event.id })
        .where(eq(schedulePolls.id, poll.id));
      eventId = event.id;
    }
  } catch (e) {
    return failure(e);
  }
  // redirectは内部でthrowするため、failure()に飲み込まれないようtryの外に置く
  redirect(`/events/${eventId}`);
}

export async function saveSettings(formData: FormData): Promise<ActionResult> {
  try {
    const input = saveSettingsSchema.parse({
      surveyUrlFirst: text(formData, "surveyUrlFirst").trim(),
      surveyUrlRepeat: text(formData, "surveyUrlRepeat").trim(),
    });

    const db = getDb();
    await setSetting(db, SETTING_KEYS.surveyUrlFirst, input.surveyUrlFirst);
    await setSetting(db, SETTING_KEYS.surveyUrlRepeat, input.surveyUrlRepeat);

    revalidatePath("/settings");
    return { ok: true, message: "保存しました" };
  } catch (e) {
    return failure(e);
  }
}
