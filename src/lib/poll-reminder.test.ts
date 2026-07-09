import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { lineGroups, schedulePolls, type SchedulePoll } from "@/db/schema";
import { toPollCandidates } from "@/lib/chouseisan";
import { jstToUtc } from "@/lib/jst";
import { checkPollReminders, computeReminderAt, sendPollReminderNow } from "./poll-reminder";

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

const CANDIDATE_DATES = [
  jstToUtc(2026, 8, 1, 20, 0),
  jstToUtc(2026, 8, 8, 20, 0),
];

async function seedPoll(
  db: Db,
  overrides: Partial<typeof schedulePolls.$inferInsert> = {},
): Promise<SchedulePoll> {
  const candidates = toPollCandidates(CANDIDATE_DATES);
  const [poll] = await db
    .insert(schedulePolls)
    .values({
      title: "8月交流会 日程調整",
      chouseisanUrl: "https://chouseisan.com/s?h=abc123",
      targetMonth: jstToUtc(2026, 8, 1),
      candidates,
      ...overrides,
    })
    .returning();
  return poll;
}

async function seedMainGroup(db: Db): Promise<void> {
  await db.insert(lineGroups).values({
    lineGroupId: "C_main",
    kind: "main",
    active: true,
    channel: 1,
  });
}

describe("computeReminderAt", () => {
  it("3日間ルール(投稿から46h)なら締切日17:00を返す", () => {
    const poll = {
      deadlineAt: jstToUtc(2026, 7, 11, 21, 0),
      postedAt: jstToUtc(2026, 7, 9, 15, 0),
    } as SchedulePoll;
    expect(computeReminderAt(poll)).toEqual(jstToUtc(2026, 7, 11, 17, 0));
  });

  it("即日締切(投稿から2h)はnull", () => {
    const poll = {
      deadlineAt: jstToUtc(2026, 7, 9, 23, 0),
      postedAt: jstToUtc(2026, 7, 9, 15, 0),
    } as SchedulePoll;
    expect(computeReminderAt(poll)).toBeNull();
  });

  it("締切時刻が17:00より前で候補が締切後になる場合はnull", () => {
    const poll = {
      deadlineAt: jstToUtc(2026, 7, 10, 12, 0),
      postedAt: jstToUtc(2026, 7, 9, 20, 0),
    } as SchedulePoll;
    expect(computeReminderAt(poll)).toBeNull();
  });

  it("deadlineAtまたはpostedAtが未設定ならnull", () => {
    expect(
      computeReminderAt({
        deadlineAt: null,
        postedAt: jstToUtc(2026, 7, 9, 15, 0),
      } as SchedulePoll),
    ).toBeNull();
    expect(
      computeReminderAt({
        deadlineAt: jstToUtc(2026, 7, 11, 21, 0),
        postedAt: null,
      } as SchedulePoll),
    ).toBeNull();
  });
});

describe("checkPollReminders", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
    await seedMainGroup(db);
  });

  it("リマインド予定時刻を過ぎたopenな行を検知して送信する", async () => {
    const poll = await seedPoll(db, {
      deadlineAt: jstToUtc(2026, 7, 11, 21, 0),
      postedAt: jstToUtc(2026, 7, 9, 15, 0),
    });
    const sent: { to: string; text: string }[] = [];

    const result = await checkPollReminders(db, {
      now: jstToUtc(2026, 7, 11, 17, 5),
      send: async (to, messages) => {
        sent.push({ to, text: (messages[0] as { text: string }).text });
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0].ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("C_main");
    expect(sent[0].text).toContain("本日21:00までです");

    const [after] = await db
      .select()
      .from(schedulePolls)
      .where(eq(schedulePolls.id, poll.id));
    expect(after.reminderSentAt).not.toBeNull();
  });

  it("リマインド予定時刻前は送信しない", async () => {
    await seedPoll(db, {
      deadlineAt: jstToUtc(2026, 7, 11, 21, 0),
      postedAt: jstToUtc(2026, 7, 9, 15, 0),
    });
    const result = await checkPollReminders(db, {
      now: jstToUtc(2026, 7, 11, 16, 0),
      send: async () => {},
    });
    expect(result).toHaveLength(0);
  });

  it("投稿から締切までが短すぎる場合は送信しない", async () => {
    await seedPoll(db, {
      deadlineAt: jstToUtc(2026, 7, 9, 23, 0),
      postedAt: jstToUtc(2026, 7, 9, 15, 0),
    });
    const result = await checkPollReminders(db, {
      now: jstToUtc(2026, 7, 9, 23, 30),
      send: async () => {},
    });
    expect(result).toHaveLength(0);
  });

  it("既に送信済み(reminderSentAtあり)の行は再送しない(冪等)", async () => {
    await seedPoll(db, {
      deadlineAt: jstToUtc(2026, 7, 11, 21, 0),
      postedAt: jstToUtc(2026, 7, 9, 15, 0),
      reminderSentAt: jstToUtc(2026, 7, 11, 17, 5),
    });
    const result = await checkPollReminders(db, {
      now: jstToUtc(2026, 7, 11, 18, 0),
      send: async () => {},
    });
    expect(result).toHaveLength(0);
  });

  it("締切超過処理が既に済んでいる行は送信しない", async () => {
    await seedPoll(db, {
      deadlineAt: jstToUtc(2026, 7, 11, 21, 0),
      postedAt: jstToUtc(2026, 7, 9, 15, 0),
      deadlineHandledAt: jstToUtc(2026, 7, 11, 21, 5),
    });
    const result = await checkPollReminders(db, {
      now: jstToUtc(2026, 7, 11, 21, 10),
      send: async () => {},
    });
    expect(result).toHaveLength(0);
  });

  it("未投稿(postedAt=null)の行は送信しない", async () => {
    await seedPoll(db, { deadlineAt: jstToUtc(2026, 7, 11, 21, 0) });
    const result = await checkPollReminders(db, {
      now: jstToUtc(2026, 7, 11, 17, 5),
      send: async () => {},
    });
    expect(result).toHaveLength(0);
  });

  it("送信失敗時もreminderSentAtはセットされ再試行しない", async () => {
    const poll = await seedPoll(db, {
      deadlineAt: jstToUtc(2026, 7, 11, 21, 0),
      postedAt: jstToUtc(2026, 7, 9, 15, 0),
    });

    const result = await checkPollReminders(db, {
      now: jstToUtc(2026, 7, 11, 17, 5),
      send: async () => {
        throw new Error("LINE API down");
      },
    });

    expect(result[0].ok).toBe(false);
    expect(result[0].error).toContain("LINE API down");

    const [after] = await db
      .select()
      .from(schedulePolls)
      .where(eq(schedulePolls.id, poll.id));
    expect(after.reminderSentAt).not.toBeNull();
  });
});

describe("sendPollReminderNow", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
    await seedMainGroup(db);
  });

  it("短すぎる判定を無視して即送信できる", async () => {
    const poll = await seedPoll(db, {
      deadlineAt: jstToUtc(2026, 7, 9, 23, 0),
      postedAt: jstToUtc(2026, 7, 9, 15, 0),
    });
    const sent: string[] = [];

    const result = await sendPollReminderNow(db, poll.id, async (to, messages) => {
      sent.push((messages[0] as { text: string }).text);
    });

    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("既に送信済みならエラーを投げる", async () => {
    const poll = await seedPoll(db, {
      deadlineAt: jstToUtc(2026, 7, 11, 21, 0),
      postedAt: jstToUtc(2026, 7, 9, 15, 0),
      reminderSentAt: jstToUtc(2026, 7, 11, 17, 5),
    });

    await expect(
      sendPollReminderNow(db, poll.id, async () => {}),
    ).rejects.toThrow("すでにリマインドを送信済みです");
  });
});
