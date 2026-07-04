"use server";

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createEventSchema,
  saveSettingsSchema,
  updateSessionSchema,
} from "@/contracts/forms";
import { getDb } from "@/db/client";
import {
  attendances,
  events,
  lineGroups,
  members,
  scheduledMessages,
  sessions,
} from "@/db/schema";
import {
  dayBeforeAt15,
  dayOfAt9,
  defaultSurveyAt,
  parseJstFromInput,
} from "@/lib/jst";
import { sendScheduledMessage } from "@/lib/send";
import { SETTING_KEYS, setSetting } from "@/lib/settings";

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

export async function createEvent(formData: FormData): Promise<void> {
  const sessionInputs: { startAt: Date }[] = [];
  for (const i of [1, 2]) {
    const date = text(formData, `date${i}`).trim();
    const time = text(formData, `time${i}`).trim();
    if (!date && !time) continue;
    if (!date || !time) {
      throw new Error(`日程${i}は日付と時刻の両方を入力してください`);
    }
    sessionInputs.push({ startAt: parseJstFromInput(`${date}T${time}`) });
  }

  const input = createEventSchema.parse({
    title: text(formData, "title"),
    sessions: sessionInputs,
  });

  const db = getDb();
  const [event] = await db
    .insert(events)
    .values({ title: input.title })
    .returning();

  // イベント作成と同時にチェックリスト(=送信キュー)を全行用意する。
  // 「何を送るべきか」が最初から全部見えることが抜け漏れ防止の core なので、
  // 後から行を足す方式にはしない。
  const smValues: (typeof scheduledMessages.$inferInsert)[] = [
    { eventId: event.id, sessionId: null, kind: "announce", scheduledAt: null },
  ];
  for (const s of input.sessions) {
    const [session] = await db
      .insert(sessions)
      .values({ eventId: event.id, startAt: s.startAt })
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
        scheduledAt: dayBeforeAt15(s.startAt),
      },
      {
        eventId: event.id,
        sessionId: session.id,
        kind: "day_of",
        scheduledAt: dayOfAt9(s.startAt),
      },
      {
        eventId: event.id,
        sessionId: session.id,
        kind: "survey",
        scheduledAt: defaultSurveyAt(s.startAt),
      },
    );
  }
  await db.insert(scheduledMessages).values(smValues);

  redirect(`/events/${event.id}`);
}

export async function updateSession(formData: FormData): Promise<void> {
  const surveyAtRaw = text(formData, "surveyAt").trim();
  const input = updateSessionSchema.parse({
    sessionId: text(formData, "sessionId"),
    eventId: text(formData, "eventId"),
    startAt: parseJstFromInput(text(formData, "startAt")),
    lineGroupId: text(formData, "lineGroupId"),
    inviteLink: text(formData, "inviteLink"),
    slideUrl: text(formData, "slideUrl"),
    meetingInfo: text(formData, "meetingInfo"),
    dayFlow: text(formData, "dayFlow"),
    surveyAt: surveyAtRaw ? parseJstFromInput(surveyAtRaw) : null,
  });

  const db = getDb();
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

  // 日程変更に予約時刻を追従させる。failed行もpendingに戻して再アーム
  // (URL未設定などで失敗した後、設定を直せば次のtickで自動送信されるように)。
  // 送信済み(sent)は履歴なので触らない。
  const reschedule = async (
    kind: "day_before" | "day_of" | "survey",
    scheduledAt: Date | null,
  ) => {
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
  await reschedule("day_before", dayBeforeAt15(input.startAt));
  await reschedule("day_of", dayOfAt9(input.startAt));
  await reschedule("survey", input.surveyAt);

  revalidatePath(`/events/${input.eventId}`);
}

export async function sendMessageAction(formData: FormData): Promise<void> {
  const id = z.uuid().parse(text(formData, "id"));
  const eventId = z.uuid().parse(text(formData, "eventId"));
  const force = text(formData, "force") === "1";

  // 失敗は scheduled_messages.error に記録され、チェックリストに表示される
  await sendScheduledMessage(getDb(), id, { force });

  revalidatePath(`/events/${eventId}`);
}

export async function addManualAttendee(formData: FormData): Promise<void> {
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
}

export async function removeAttendance(formData: FormData): Promise<void> {
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
}

export async function markEventDone(formData: FormData): Promise<void> {
  const eventId = z.uuid().parse(text(formData, "eventId"));
  await getDb()
    .update(events)
    .set({ status: "done" })
    .where(eq(events.id, eventId));
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/");
}

export async function deleteEvent(formData: FormData): Promise<void> {
  const eventId = z.uuid().parse(text(formData, "eventId"));
  await getDb().delete(events).where(eq(events.id, eventId));
  redirect("/");
}

export async function setGroupKind(formData: FormData): Promise<void> {
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
}

export async function saveSettings(formData: FormData): Promise<void> {
  const input = saveSettingsSchema.parse({
    surveyUrlFirst: text(formData, "surveyUrlFirst").trim(),
    surveyUrlRepeat: text(formData, "surveyUrlRepeat").trim(),
  });

  const db = getDb();
  await setSetting(db, SETTING_KEYS.surveyUrlFirst, input.surveyUrlFirst);
  await setSetting(db, SETTING_KEYS.surveyUrlRepeat, input.surveyUrlRepeat);

  revalidatePath("/settings");
}
