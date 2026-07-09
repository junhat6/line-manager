import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { events, schedulePolls, type SchedulePoll } from "@/db/schema";
import { toPollCandidates } from "@/lib/chouseisan";
import { jstToUtc } from "@/lib/jst";
import { importPollResults } from "./poll-import";

// 本物のPostgres方言を検証したいので、モックではなくPGlite(WASMのPostgres)を使う
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
  jstToUtc(2026, 8, 15, 20, 0),
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

// 8/1: ○2+△1=2.5点 / 8/8: ○3=3点 / 8/15: △1+×2=0.5点
const VOTED_CSV = [
  "8月交流会 日程調整",
  "○△×で入力してください",
  "日程,山田,田中,佐藤,鈴木",
  "8/1(土) 20:00,○,×,△,○",
  "8/8(土) 20:00,○,○,○,△",
  "8/15(土) 20:00,△,,×,×",
].join("\n");

const EMPTY_CSV = [
  "日程,山田",
  "8/1(土) 20:00,",
  "8/8(土) 20:00,",
  "8/15(土) 20:00,",
].join("\n");

describe("importPollResults", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("投票があれば得点上位2日程でイベントを自動作成し、statusをimportedにする", async () => {
    const poll = await seedPoll(db);
    const outcome = await importPollResults(db, poll, {
      fetchCsv: async () => VOTED_CSV,
    });

    expect(outcome.kind).toBe("imported");
    if (outcome.kind !== "imported") throw new Error("unreachable");
    expect(outcome.adopted.map((c) => c.label).sort()).toEqual(
      ["8/1(土) 20:00", "8/8(土) 20:00"].sort(),
    );
    expect(outcome.adopted.find((c) => c.label === "8/8(土) 20:00")?.voters).toEqual(
      { attend: ["山田", "田中", "佐藤"], maybe: ["鈴木"], absent: [] },
    );

    const [updated] = await db
      .select()
      .from(schedulePolls)
      .where(eq(schedulePolls.id, poll.id));
    expect(updated.status).toBe("imported");
    expect(updated.importedEventId).toBe(outcome.eventId);
  });

  it("誰も投票していない場合はイベントを作らずno_votesを返す", async () => {
    const poll = await seedPoll(db);
    const outcome = await importPollResults(db, poll, {
      fetchCsv: async () => EMPTY_CSV,
    });

    expect(outcome.kind).toBe("no_votes");
    const [after] = await db
      .select()
      .from(schedulePolls)
      .where(eq(schedulePolls.id, poll.id));
    expect(after.status).toBe("open");
    expect(after.importedEventId).toBeNull();
  });

  it("候補が集計できないCSVはno_candidatesを返す", async () => {
    const poll = await seedPoll(db);
    const outcome = await importPollResults(db, poll, {
      fetchCsv: async () => "全く関係ない内容だけの行",
    });
    expect(outcome.kind).toBe("no_candidates");
  });

  it("既にimported済みならCSVを取得せずalready_importedを返す", async () => {
    const [event] = await db
      .insert(events)
      .values({ title: "既存イベント" })
      .returning();
    const poll = await seedPoll(db, {
      status: "imported",
      importedEventId: event.id,
    });

    let fetchCalled = false;
    const outcome = await importPollResults(db, poll, {
      fetchCsv: async () => {
        fetchCalled = true;
        return VOTED_CSV;
      },
    });

    expect(outcome).toEqual({ kind: "already_imported", eventId: event.id });
    expect(fetchCalled).toBe(false);
  });

  it("他プロセスがクレーム中(importingAtが新しい)ならin_progressを返しCSVを取得しない", async () => {
    const poll = await seedPoll(db, {
      importingAt: jstToUtc(2026, 7, 25, 21, 0),
    });

    let fetchCalled = false;
    const outcome = await importPollResults(db, poll, {
      now: jstToUtc(2026, 7, 25, 21, 1), // 1分後。stale閾値(5分)内
      fetchCsv: async () => {
        fetchCalled = true;
        return VOTED_CSV;
      },
    });

    expect(outcome).toEqual({ kind: "in_progress" });
    expect(fetchCalled).toBe(false);
  });

  it("importingAtがstale(5分超過)なら再クレームして処理を進める", async () => {
    const poll = await seedPoll(db, {
      importingAt: jstToUtc(2026, 7, 25, 21, 0),
    });

    const outcome = await importPollResults(db, poll, {
      now: jstToUtc(2026, 7, 25, 21, 10), // 10分後。stale閾値超過
      fetchCsv: async () => VOTED_CSV,
    });

    expect(outcome.kind).toBe("imported");
  });

  it("クレーム失敗中に他方が取込を完了させていればDBから拾い直してalready_importedを返す", async () => {
    const poll = await seedPoll(db);
    // 別プロセスがクレームを保持したまま取込を完了させた状況を再現する
    const [event] = await db
      .insert(events)
      .values({ title: "先に取り込まれたイベント" })
      .returning();
    await db
      .update(schedulePolls)
      .set({
        importingAt: jstToUtc(2026, 7, 25, 21, 0),
        status: "imported",
        importedEventId: event.id,
      })
      .where(eq(schedulePolls.id, poll.id));

    // poll変数自体は取得直後(status: open)のまま。呼び出し時点のstatusは
    // クレームのWHERE句で再評価されるため、実DBの状態(imported)が反映される
    const outcome = await importPollResults(db, poll, {
      now: jstToUtc(2026, 7, 25, 21, 1),
      fetchCsv: async () => VOTED_CSV,
    });

    expect(outcome).toEqual({ kind: "already_imported", eventId: event.id });
  });

  it("取込中にエラーが起きたらimportingAtを解放し、再試行できる", async () => {
    const poll = await seedPoll(db);

    await expect(
      importPollResults(db, poll, {
        fetchCsv: async () => {
          throw new Error("調整さんのページ取得に失敗しました(HTTP 500)");
        },
      }),
    ).rejects.toThrow("調整さんのページ取得に失敗しました");

    const [after] = await db
      .select()
      .from(schedulePolls)
      .where(eq(schedulePolls.id, poll.id));
    expect(after.importingAt).toBeNull();

    const retried = await importPollResults(db, after, {
      fetchCsv: async () => VOTED_CSV,
    });
    expect(retried.kind).toBe("imported");
  });

  it("no_votes/no_candidatesで終わった場合もimportingAtを解放し、再試行できる", async () => {
    const poll = await seedPoll(db);

    const first = await importPollResults(db, poll, {
      fetchCsv: async () => EMPTY_CSV,
    });
    expect(first.kind).toBe("no_votes");

    const [after] = await db
      .select()
      .from(schedulePolls)
      .where(eq(schedulePolls.id, poll.id));
    expect(after.importingAt).toBeNull();

    const retried = await importPollResults(db, after, {
      fetchCsv: async () => VOTED_CSV,
    });
    expect(retried.kind).toBe("imported");
  });
});
