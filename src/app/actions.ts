"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createEventSchema,
  saveSettingsSchema,
  startCustomSchedulePollSchema,
  startSchedulePollSchema,
  updateSessionSchema,
  type ActionResult,
} from "@/contracts/forms";
import { getDb, type Db } from "@/db/client";
import {
  events,
  lineGroups,
  schedulePolls,
  scheduledMessages,
  sessions,
  type SchedulePoll,
} from "@/db/schema";
import {
  buildMonthCandidateDates,
  createChouseisanEvent,
  nextMonthStart,
  toPollCandidates,
} from "@/lib/chouseisan";
import { jstToUtc, parseJstFromInput, toJstParts } from "@/lib/jst";
import { pushMessages } from "@/lib/line/client";
import { createEventWithSessions, importPollResults } from "@/lib/poll-import";
import { sendPollReminderNow } from "@/lib/poll-reminder";
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

/** "HH:MM" を [hour, minute] に分解する(zodでhalfHourTime検証済みの値を渡す) */
function splitTime(time: string): [number, number] {
  const [hour, minute] = time.split(":").map(Number);
  return [hour, minute];
}

/**
 * 日程調整の作成共通処理(かんたん/カスタムの合流点):
 * 調整さんにイベントを作成して行を保存し、URLをメイングループに投稿する。
 * candidateDates は各候補の開催開始日時。タイトルと対象月は最初(最早)の候補日の月から決める。
 * 投稿本文はフォームで編集でき、再投稿でも同じ本文を使うため行に保存する。
 */
async function createPollAndPost(
  message: string,
  candidateDates: Date[],
  deadlineAt: Date,
): Promise<ActionResult> {
  if (deadlineAt.getTime() <= Date.now()) {
    return { ok: false, message: "締切日時は未来の日時にしてください" };
  }
  const earliestCandidate = Math.min(...candidateDates.map((d) => d.getTime()));
  if (deadlineAt.getTime() >= earliestCandidate) {
    return {
      ok: false,
      message: "締切は最も早い候補日より前にしてください",
    };
  }

  const db = getDb();
  const candidates = toPollCandidates(candidateDates);
  const first = toJstParts(new Date(candidates[0].startAt));
  const targetMonth = jstToUtc(first.year, first.month, 1);
  const title = `${first.month}月交流会 日程調整`;

  const { url } = await createChouseisanEvent({
    title,
    comment:
      "参加できる日時に◯、調整すれば参加できる日時に△、難しい日時に×をお願いします!",
    candidates: candidates.map((c) => c.label),
  });

  const [poll] = await db
    .insert(schedulePolls)
    .values({
      title,
      chouseisanUrl: url,
      targetMonth,
      message,
      candidates,
      deadlineAt,
    })
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
}

/**
 * かんたん作成: 来月の全日程(共通の開始時刻)を候補にした日程調整を開始する。
 */
export async function startSchedulePoll(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const input = startSchedulePollSchema.parse({
      message: text(formData, "message"),
      time: text(formData, "time"),
      deadline: text(formData, "deadline"),
    });

    const [hour, minute] = splitTime(input.time);
    return await createPollAndPost(
      input.message,
      buildMonthCandidateDates(nextMonthStart(new Date()), hour, minute),
      parseJstFromInput(input.deadline),
    );
  } catch (e) {
    return failure(e);
  }
}

/**
 * カスタム作成: カレンダーで選んだ日付と開始時刻の組み合わせを候補にした日程調整を開始する。
 * 候補はクライアントで組み立てたJSON(hidden input)で受け取る。
 */
export async function startCustomSchedulePoll(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const input = startCustomSchedulePollSchema.parse({
      message: text(formData, "message"),
      deadline: text(formData, "deadline"),
      candidates: parseJsonOrEmptyArray(text(formData, "candidates")),
    });

    return await createPollAndPost(
      input.message,
      input.candidates.map((c) => parseJstFromInput(`${c.date}T${c.time}`)),
      parseJstFromInput(input.deadline),
    );
  } catch (e) {
    return failure(e);
  }
}

/** 壊れたJSONは空配列に落とし、zodの「候補日を選んでください」エラーに合流させる */
function parseJsonOrEmptyArray(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return [];
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

/** 日程調整の締切当日リマインドの手動送信(自動送信がスキップ/失敗したケースの救済) */
export async function sendPollReminder(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const id = z.uuid().parse(text(formData, "id"));
    const db = getDb();
    await sendPollReminderNow(db, id);
    revalidatePath("/polls");
    return { ok: true, message: "リマインドを送信しました" };
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

    const outcome = await importPollResults(db, poll);
    switch (outcome.kind) {
      case "no_candidates":
        return {
          ok: false,
          message:
            "集計できる候補が見つかりません(調整さんのページ構成が変わった可能性があります)",
        };
      case "no_votes":
        return {
          ok: false,
          message:
            "まだ回答がありません(全候補0点)。回答が集まってから取り込んでください",
        };
      case "in_progress":
        return {
          ok: false,
          message:
            "ちょうど自動取込の処理中です。しばらくしてから再度お試しください",
        };
      case "already_imported":
      case "imported":
        eventId = outcome.eventId;
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
