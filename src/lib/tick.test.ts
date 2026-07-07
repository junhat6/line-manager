import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { messagingApi } from "@line/bot-sdk";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import {
  events,
  lineGroups,
  scheduledMessages,
  sessions,
} from "@/db/schema";
import { sendScheduledMessage } from "./send";
import { runTick } from "./tick";

// 本物のPostgres方言でclaimのSQL(原子的なUPDATE ... RETURNING)を検証したいので
// モックではなくPGlite(WASMのPostgres)を使う
async function createTestDb(): Promise<Db> {
  const client = new PGlite();
  const migrationsDir = join(__dirname, "../../drizzle");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await client.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Db;
}

type Sent = { to: string; messages: messagingApi.Message[]; channel: number };

async function seedSession(
  db: Db,
  overrides: Partial<typeof sessions.$inferInsert> = {},
) {
  const [event] = await db
    .insert(events)
    .values({ title: "テスト交流会" })
    .returning();
  await db.insert(lineGroups).values({
    lineGroupId: "G-session",
    name: "7/18グループ",
    kind: "session",
  });
  const [session] = await db
    .insert(sessions)
    .values({
      eventId: event.id,
      startAt: new Date("2026-07-18T19:00:00+09:00"),
      lineGroupId: "G-session",
      slideUrl: "https://example.com/slide",
      meetingInfo: "Zoom",
      ...overrides,
    })
    .returning();
  return { event, session };
}

describe("runTick", () => {
  let db: Db;
  let sent: Sent[];
  const send = async (
    to: string,
    messages: messagingApi.Message[],
    channel: number,
  ) => {
    sent.push({ to, messages, channel });
  };

  beforeEach(async () => {
    db = await createTestDb();
    sent = [];
  });

  it("期限到来したpending行を送信し、2回目のtickでは再送しない(冪等)", async () => {
    const { event, session } = await seedSession(db);
    await db.insert(scheduledMessages).values({
      eventId: event.id,
      sessionId: session.id,
      kind: "day_before",
      scheduledAt: new Date("2026-07-17T15:00:00+09:00"),
    });
    const now = new Date("2026-07-17T15:02:00+09:00");

    const first = await runTick(db, { now, send });
    expect(first.results).toHaveLength(1);
    expect(first.results[0].ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("G-session");

    const second = await runTick(db, { now, send });
    expect(second.results).toHaveLength(0);
    expect(sent).toHaveLength(1);
  });

  it("期限前の行は送らない", async () => {
    const { event, session } = await seedSession(db);
    await db.insert(scheduledMessages).values({
      eventId: event.id,
      sessionId: session.id,
      kind: "day_of",
      scheduledAt: new Date("2026-07-18T09:00:00+09:00"),
    });

    const result = await runTick(db, {
      now: new Date("2026-07-18T08:55:00+09:00"),
      send,
    });
    expect(result.results).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("前提が欠けている行はfailedになり、理由が記録される", async () => {
    const { event, session } = await seedSession(db, { lineGroupId: null });
    const [row] = await db
      .insert(scheduledMessages)
      .values({
        eventId: event.id,
        sessionId: session.id,
        kind: "day_before",
        scheduledAt: new Date("2026-07-17T15:00:00+09:00"),
      })
      .returning();

    const result = await runTick(db, {
      now: new Date("2026-07-17T15:02:00+09:00"),
      send,
    });
    expect(result.results[0].ok).toBe(false);
    expect(sent).toHaveLength(0);

    const [after] = await db
      .select()
      .from(scheduledMessages)
      .where(eq(scheduledMessages.id, row.id));
    expect(after.status).toBe("failed");
    expect(after.error).toContain("未紐付け");
  });

  it("failedの行は設定を直したあと手動で再送できる", async () => {
    const { event, session } = await seedSession(db, { lineGroupId: null });
    const [row] = await db
      .insert(scheduledMessages)
      .values({
        eventId: event.id,
        sessionId: session.id,
        kind: "slide_request",
        scheduledAt: null,
      })
      .returning();

    const failed = await sendScheduledMessage(db, row.id, { send });
    expect(failed?.ok).toBe(false);

    await db
      .update(sessions)
      .set({ lineGroupId: "G-session" })
      .where(eq(sessions.id, session.id));

    const retried = await sendScheduledMessage(db, row.id, { send });
    expect(retried?.ok).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("送信済みの行はforceなしではclaimできない", async () => {
    const { event, session } = await seedSession(db);
    const [row] = await db
      .insert(scheduledMessages)
      .values({
        eventId: event.id,
        sessionId: session.id,
        kind: "survey",
        scheduledAt: null,
        status: "sent",
        sentAt: new Date(),
      })
      .returning();

    expect(await sendScheduledMessage(db, row.id, { send })).toBeNull();
    expect(sent).toHaveLength(0);

    const forced = await sendScheduledMessage(db, row.id, {
      send,
      force: true,
    });
    expect(forced?.ok).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("sendingのまま放置された行は次のtickでfailedとして回収される", async () => {
    const { event, session } = await seedSession(db);
    const [row] = await db
      .insert(scheduledMessages)
      .values({
        eventId: event.id,
        sessionId: session.id,
        kind: "day_before",
        scheduledAt: new Date("2026-07-17T15:00:00+09:00"),
        status: "sending",
        claimedAt: new Date("2026-07-17T15:01:00+09:00"),
      })
      .returning();

    const result = await runTick(db, {
      now: new Date("2026-07-17T15:30:00+09:00"),
      send,
    });
    expect(result.staleFailed).toBe(1);
    expect(sent).toHaveLength(0);

    const [after] = await db
      .select()
      .from(scheduledMessages)
      .where(eq(scheduledMessages.id, row.id));
    expect(after.status).toBe("failed");
  });

  it("日程別グループを担当するチャネルで送信される(チャネル2のグループ)", async () => {
    const { event, session } = await seedSession(db);
    await db
      .update(lineGroups)
      .set({ channel: 2 })
      .where(eq(lineGroups.lineGroupId, "G-session"));
    await db.insert(scheduledMessages).values({
      eventId: event.id,
      sessionId: session.id,
      kind: "day_before",
      scheduledAt: new Date("2026-07-17T15:00:00+09:00"),
    });

    const result = await runTick(db, {
      now: new Date("2026-07-17T15:02:00+09:00"),
      send,
    });
    expect(result.results[0].ok).toBe(true);
    expect(sent[0].to).toBe("G-session");
    expect(sent[0].channel).toBe(2);
  });

  it("メイングループ宛(group_invite)はメイングループのチャネルで送信される", async () => {
    const { event, session } = await seedSession(db, {
      inviteLink: "https://line.me/ti/g/xxxx",
    });
    await db.insert(lineGroups).values({
      lineGroupId: "G-main",
      name: "メイン",
      kind: "main",
    });
    const [row] = await db
      .insert(scheduledMessages)
      .values({ eventId: event.id, sessionId: session.id, kind: "group_invite" })
      .returning();

    const result = await sendScheduledMessage(db, row.id, { send });
    expect(result?.ok).toBe(true);
    expect(sent[0].to).toBe("G-main");
    expect(sent[0].channel).toBe(1);
  });

  it("紐付いたグループがグループ一覧に無い日程はfailedになり理由が記録される", async () => {
    const { event, session } = await seedSession(db, {
      lineGroupId: "G-ghost",
    });
    const [row] = await db
      .insert(scheduledMessages)
      .values({
        eventId: event.id,
        sessionId: session.id,
        kind: "day_before",
        scheduledAt: new Date("2026-07-17T15:00:00+09:00"),
      })
      .returning();

    const result = await runTick(db, {
      now: new Date("2026-07-17T15:02:00+09:00"),
      send,
    });
    expect(result.results[0].ok).toBe(false);
    expect(sent).toHaveLength(0);

    const [after] = await db
      .select()
      .from(scheduledMessages)
      .where(eq(scheduledMessages.id, row.id));
    expect(after.status).toBe("failed");
    expect(after.error).toContain("グループ一覧に見つかりません");
  });

});
