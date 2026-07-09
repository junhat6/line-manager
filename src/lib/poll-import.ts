import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  events,
  schedulePolls,
  scheduledMessages,
  sessions,
  type SchedulePoll,
} from "@/db/schema";
import {
  type CandidateResult,
  fetchChouseisanCsv,
  parseChouseisanCsv,
  rankCandidates,
  tallyChouseisanCsvByLabel,
} from "@/lib/chouseisan";
import {
  dayBeforeAt15,
  dayOfAt9,
  defaultSurveyAt,
  jstToUtc,
  toJstParts,
} from "@/lib/jst";

/**
 * candidates未保存の既存行の取込で使う開催時刻
 * (現在の作成フローは候補ごとに開始時刻を持つため、ここは使わない)
 */
const DEFAULT_SESSION_HOUR = 19;

/**
 * イベント + 日程 + チェックリスト(=送信キュー)を一括作成する。
 * 「何を送るべきか」が最初から全部見えることが抜け漏れ防止の core なので、
 * 後から行を足す方式にはしない。フォームからの作成と日程調整の取込の共通処理。
 */
export async function createEventWithSessions(
  db: Db,
  title: string,
  startAts: Date[],
): Promise<{ id: string }> {
  const [event] = await db.insert(events).values({ title }).returning();

  const smValues: (typeof scheduledMessages.$inferInsert)[] = [];
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

export type PollImportOutcome =
  | { kind: "already_imported"; eventId: string }
  | {
      kind: "imported";
      eventId: string;
      /** score降順の全候補(0票の候補も含む) */
      ranked: CandidateResult[];
      /** イベント化された上位2日程(scoreでソート。日付順ではない) */
      adopted: CandidateResult[];
    }
  | { kind: "no_candidates" }
  | { kind: "no_votes"; ranked: CandidateResult[] }
  /** 手動の「結果を取り込む」とcronの自動取込がほぼ同時に走った場合など、他の処理がこの行を処理中 */
  | { kind: "in_progress" };

/** クレーム(importingAt)が古いとみなし再取込を許可するまでの時間。CSV取得〜イベント作成は通常数秒で終わるため十分な余裕 */
const IMPORTING_STALE_MS = 5 * 60 * 1000;

/**
 * 調整さんの回答を集計し、上位2日程(◯=1点・△=0.5点、同点は早い日付優先)で
 * イベントを自動作成する。Server Action(手動の「結果を取り込む」)とcron(締切自動取込)の
 * 両方から呼ばれる共通ロジック。
 *
 * 両者がほぼ同時に同じ行を処理すると、調整さんCSVの取得〜イベント作成が二重に走り、
 * 片方のイベントがschedulePollsから孤立したまま(status更新は後勝ちで上書きされる)
 * その予約メッセージ(前日案内・当日案内・アンケート)だけ実際に送信されてしまう。
 * これを防ぐため、CSV取得の前に importingAt でクレームを取り、取れなければ諦める。
 */
export async function importPollResults(
  db: Db,
  poll: SchedulePoll,
  opts: { fetchCsv?: (url: string) => Promise<string>; now?: Date } = {},
): Promise<PollImportOutcome> {
  if (poll.status === "imported" && poll.importedEventId) {
    return { kind: "already_imported", eventId: poll.importedEventId };
  }

  const now = opts.now ?? new Date();
  const staleBefore = new Date(now.getTime() - IMPORTING_STALE_MS);
  const claimed = await db
    .update(schedulePolls)
    .set({ importingAt: now })
    .where(
      and(
        eq(schedulePolls.id, poll.id),
        eq(schedulePolls.status, "open"),
        or(
          isNull(schedulePolls.importingAt),
          lt(schedulePolls.importingAt, staleBefore),
        ),
      ),
    )
    .returning();
  if (claimed.length === 0) {
    // クレームできなかった間にもう一方が取込を完了させている可能性があるので拾い直す
    const [current] = await db
      .select()
      .from(schedulePolls)
      .where(eq(schedulePolls.id, poll.id));
    if (current?.status === "imported" && current.importedEventId) {
      return { kind: "already_imported", eventId: current.importedEventId };
    }
    return { kind: "in_progress" };
  }

  try {
    const outcome = await doImport(db, poll, opts.fetchCsv);
    // imported以外(0票・候補なし)は次の試行をブロックしないようクレームを解放する
    if (outcome.kind !== "imported") {
      await db
        .update(schedulePolls)
        .set({ importingAt: null })
        .where(eq(schedulePolls.id, poll.id));
    }
    return outcome;
  } catch (e) {
    await db
      .update(schedulePolls)
      .set({ importingAt: null })
      .where(eq(schedulePolls.id, poll.id));
    throw e;
  }
}

async function doImport(
  db: Db,
  poll: SchedulePoll,
  fetchCsvOverride?: (url: string) => Promise<string>,
): Promise<PollImportOutcome> {
  const fetchCsv = fetchCsvOverride ?? fetchChouseisanCsv;
  const csv = await fetchCsv(poll.chouseisanUrl);
  // candidates保存済みの行はラベル完全一致で照合し、開始時刻も候補が持つ。
  // 未保存の既存行は旧ロジック(対象月のM/Dパース + 既定時刻)で取り込む
  const ranked = rankCandidates(
    poll.candidates
      ? tallyChouseisanCsvByLabel(csv, poll.candidates)
      : parseChouseisanCsv(csv, poll.targetMonth),
  );
  if (ranked.length === 0) {
    return { kind: "no_candidates" };
  }
  if (ranked[0].score <= 0) {
    return { kind: "no_votes", ranked };
  }

  const adopted = ranked.slice(0, 2);
  const startAts = adopted
    .map((c) => {
      if (poll.candidates) return c.date;
      const p = toJstParts(c.date);
      return jstToUtc(p.year, p.month, p.day, DEFAULT_SESSION_HOUR, 0);
    })
    .sort((a, b) => a.getTime() - b.getTime());

  const month = toJstParts(poll.targetMonth).month;
  const event = await createEventWithSessions(db, `${month}月交流会`, startAts);
  await db
    .update(schedulePolls)
    .set({ status: "imported", importedEventId: event.id })
    .where(eq(schedulePolls.id, poll.id));

  return { kind: "imported", eventId: event.id, ranked, adopted };
}
