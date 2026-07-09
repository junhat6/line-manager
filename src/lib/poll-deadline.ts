import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { schedulePolls, type SchedulePoll } from "@/db/schema";
import { importPollResults } from "@/lib/poll-import";
import {
  buildPollDeadlineSlackText,
  postSlackMessage,
  type PollDeadlineNotifyOutcome,
} from "@/lib/slack";

export type PollDeadlineResult = {
  pollId: string;
  title: string;
  outcome: PollDeadlineNotifyOutcome;
}[];

/**
 * 締切超過したopenな日程調整を検知し、結果を取り込んでSlackに通知する。
 * 検知とクレーム(deadlineHandledAtのセット)を1つのUPDATEで行い、cronの二重起動や
 * スロー処理でも同じ行が二重処理されないようにする(sendScheduledMessageの
 * status:sendingクレームと同じ考え方)。エラー・0票いずれの結果でも自動リトライは
 * しない(復旧手段は既存の手動「結果を取り込む」ボタン)。
 */
export async function checkPollDeadlines(
  db: Db,
  opts: {
    now?: Date;
    notify?: (text: string) => Promise<void>;
    fetchCsv?: (url: string) => Promise<string>;
  } = {},
): Promise<PollDeadlineResult> {
  const now = opts.now ?? new Date();
  const notify = opts.notify ?? postSlackMessage;

  const claimed = await db
    .update(schedulePolls)
    .set({ deadlineHandledAt: now })
    .where(
      and(
        eq(schedulePolls.status, "open"),
        isNotNull(schedulePolls.deadlineAt),
        lte(schedulePolls.deadlineAt, now),
        isNull(schedulePolls.deadlineHandledAt),
      ),
    )
    .returning();

  const results: PollDeadlineResult = [];
  for (const poll of claimed) {
    const outcome = await resolveOutcome(db, poll, now, opts.fetchCsv);
    results.push({ pollId: poll.id, title: poll.title, outcome });
    try {
      await notify(buildPollDeadlineSlackText(poll, outcome));
    } catch (e) {
      // 通知の失敗はDB状態に影響させない。締切処理そのものは完了しているため
      console.error("poll deadline slack notify failed", poll.id, e);
    }
  }
  return results;
}

async function resolveOutcome(
  db: Db,
  poll: SchedulePoll,
  now: Date,
  fetchCsv?: (url: string) => Promise<string>,
): Promise<PollDeadlineNotifyOutcome> {
  try {
    return await importPollResults(db, poll, { now, fetchCsv });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("poll deadline import failed", poll.id, e);
    return { kind: "error", message };
  }
}
