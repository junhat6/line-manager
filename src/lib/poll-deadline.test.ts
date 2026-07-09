import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { schedulePolls, type SchedulePoll } from "@/db/schema";
import { toPollCandidates } from "@/lib/chouseisan";
import { jstToUtc } from "@/lib/jst";
import { checkPollDeadlines } from "./poll-deadline";

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

const VOTED_CSV = [
  "日程,山田,田中",
  "8/1(土) 20:00,○,○",
  "8/8(土) 20:00,○,△",
].join("\n");

const EMPTY_CSV = ["日程,山田", "8/1(土) 20:00,", "8/8(土) 20:00,"].join("\n");

describe("checkPollDeadlines", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("締切を過ぎたopenな行を検知して自動取込し、通知する", async () => {
    const poll = await seedPoll(db, { deadlineAt: jstToUtc(2026, 7, 25, 21, 0) });
    const notified: string[] = [];

    const result = await checkPollDeadlines(db, {
      now: jstToUtc(2026, 7, 25, 21, 5),
      notify: async (text) => {
        notified.push(text);
      },
      fetchCsv: async () => VOTED_CSV,
    });

    expect(result).toHaveLength(1);
    expect(result[0].outcome.kind).toBe("imported");
    expect(notified).toHaveLength(1);
    // 上位2日程(8/1・8/8とも◯/△が入っている)の投票者が通知本文に含まれる
    expect(notified[0]).toContain("山田");
    expect(notified[0]).toContain("田中");

    const [after] = await db
      .select()
      .from(schedulePolls)
      .where(eq(schedulePolls.id, poll.id));
    expect(after.status).toBe("imported");
    expect(after.deadlineHandledAt).not.toBeNull();
  });

  it("締切前の行は処理しない", async () => {
    await seedPoll(db, { deadlineAt: jstToUtc(2026, 7, 25, 21, 0) });
    const result = await checkPollDeadlines(db, {
      now: jstToUtc(2026, 7, 25, 20, 0),
      fetchCsv: async () => VOTED_CSV,
    });
    expect(result).toHaveLength(0);
  });

  it("締切未設定(deadlineAt=null)の行は処理しない", async () => {
    await seedPoll(db);
    const result = await checkPollDeadlines(db, {
      now: jstToUtc(2026, 8, 1, 0, 0),
      fetchCsv: async () => VOTED_CSV,
    });
    expect(result).toHaveLength(0);
  });

  it("既に処理済み(deadlineHandledAtあり)の行は再処理しない(冪等)", async () => {
    await seedPoll(db, {
      deadlineAt: jstToUtc(2026, 7, 25, 21, 0),
      deadlineHandledAt: jstToUtc(2026, 7, 25, 21, 5),
    });
    const result = await checkPollDeadlines(db, {
      now: jstToUtc(2026, 7, 25, 21, 10),
      fetchCsv: async () => VOTED_CSV,
    });
    expect(result).toHaveLength(0);
  });

  it("取込中の例外はerrorとして記録され、statusは変えずdeadlineHandledAtだけ立てる(再試行しない)", async () => {
    const poll = await seedPoll(db, { deadlineAt: jstToUtc(2026, 7, 25, 21, 0) });
    const notified: string[] = [];

    const result = await checkPollDeadlines(db, {
      now: jstToUtc(2026, 7, 25, 21, 5),
      notify: async (text) => {
        notified.push(text);
      },
      fetchCsv: async () => {
        throw new Error("調整さんのページ取得に失敗しました(HTTP 500)");
      },
    });

    expect(result[0].outcome).toEqual({
      kind: "error",
      message: "調整さんのページ取得に失敗しました(HTTP 500)",
    });
    expect(notified[0]).toContain("自動取込に失敗しました");

    const [after] = await db
      .select()
      .from(schedulePolls)
      .where(eq(schedulePolls.id, poll.id));
    expect(after.status).toBe("open");
    expect(after.deadlineHandledAt).not.toBeNull();
  });

  it("0票の場合はイベントを作らず、手動導線をSlackで案内する", async () => {
    await seedPoll(db, { deadlineAt: jstToUtc(2026, 7, 25, 21, 0) });
    const notified: string[] = [];

    await checkPollDeadlines(db, {
      now: jstToUtc(2026, 7, 25, 21, 5),
      notify: async (text) => {
        notified.push(text);
      },
      fetchCsv: async () => EMPTY_CSV,
    });

    expect(notified[0]).toContain("回答が集まりませんでした");
  });

  it("通知(Slack)が失敗してもDB状態は既に確定済みで例外を投げない", async () => {
    const poll = await seedPoll(db, { deadlineAt: jstToUtc(2026, 7, 25, 21, 0) });

    const result = await checkPollDeadlines(db, {
      now: jstToUtc(2026, 7, 25, 21, 5),
      notify: async () => {
        throw new Error("Slack webhook down");
      },
      fetchCsv: async () => VOTED_CSV,
    });

    expect(result[0].outcome.kind).toBe("imported");
    const [after] = await db
      .select()
      .from(schedulePolls)
      .where(eq(schedulePolls.id, poll.id));
    expect(after.status).toBe("imported");
  });
});
