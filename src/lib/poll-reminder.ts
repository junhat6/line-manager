import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { schedulePolls, type SchedulePoll } from "@/db/schema";
import { formatJstTime, jstToUtc, toJstParts } from "@/lib/jst";
import { pushMessages } from "@/lib/line/client";
import { requireMainGroup, type SendFn } from "@/lib/send";
import { buildPollReminderMessages } from "@/lib/templates";

/**
 * 投稿からリマインド予定時刻までに最低限空けたい間隔。
 * 即日・翌日締切のように投稿から締切までが短い日程調整では、
 * リマインドを送っても間に合わない・意味が薄いため送信対象から外す。
 */
const MIN_GAP_FROM_POST_MS = 24 * 60 * 60 * 1000;

/**
 * 締切当日のリマインド予定時刻(締切日 17:00 JST)を算出する。
 * 以下のいずれかに該当する場合はリマインド不要としてnullを返す:
 * - 締切自体が17:00より前(候補時刻が締切を過ぎてしまい成立しない)
 * - 投稿からリマインド予定時刻までがMIN_GAP_FROM_POST_MS未満(投稿から締切までが短すぎる)
 */
export function computeReminderAt(poll: SchedulePoll): Date | null {
  if (!poll.deadlineAt || !poll.postedAt) return null;
  const d = toJstParts(poll.deadlineAt);
  const candidate = jstToUtc(d.year, d.month, d.day, 17, 0);
  if (candidate.getTime() >= poll.deadlineAt.getTime()) return null;
  if (candidate.getTime() - poll.postedAt.getTime() < MIN_GAP_FROM_POST_MS) {
    return null;
  }
  return candidate;
}

export type PollReminderResult = {
  pollId: string;
  title: string;
  ok: boolean;
  error?: string;
}[];

/**
 * リマインド予定時刻を過ぎた未送信の日程調整を検知し、メイングループに送信する。
 * checkPollDeadlines(poll-deadline.ts)と同じく、クレーム(reminderSentAtのセット)を
 * 先に行ってから送信するため、cronの重複起動でも二重送信にならない。送信自体が
 * 失敗しても自動リトライはしない(復旧手段は管理画面の手動送信ボタン)。
 */
export async function checkPollReminders(
  db: Db,
  opts: { now?: Date; send?: SendFn } = {},
): Promise<PollReminderResult> {
  const now = opts.now ?? new Date();

  const candidates = await db
    .select()
    .from(schedulePolls)
    .where(
      and(
        eq(schedulePolls.status, "open"),
        isNotNull(schedulePolls.deadlineAt),
        isNotNull(schedulePolls.postedAt),
        isNull(schedulePolls.reminderSentAt),
        isNull(schedulePolls.deadlineHandledAt),
      ),
    );

  const due = candidates.filter((poll) => {
    const reminderAt = computeReminderAt(poll);
    return reminderAt !== null && reminderAt.getTime() <= now.getTime();
  });

  const results: PollReminderResult = [];
  for (const poll of due) {
    const claimed = await db
      .update(schedulePolls)
      .set({ reminderSentAt: now })
      .where(
        and(eq(schedulePolls.id, poll.id), isNull(schedulePolls.reminderSentAt)),
      )
      .returning();
    if (claimed.length === 0) continue; // 他プロセスに先を越された(冪等)

    results.push(await sendReminder(db, poll, opts.send));
  }
  return results;
}

/**
 * 管理画面の「リマインドを送る」ボタンから呼ばれる手動送信。
 * computeReminderAtの判定(短すぎる場合はスキップ)は無視して、未送信であれば即送信する —
 * 運営が「自動ではスキップされたが今回は送りたい」と判断したケースの救済導線。
 */
export async function sendPollReminderNow(
  db: Db,
  pollId: string,
  send?: SendFn,
): Promise<PollReminderResult[number]> {
  const [poll] = await db
    .select()
    .from(schedulePolls)
    .where(eq(schedulePolls.id, pollId));
  if (!poll) throw new Error("日程調整が見つかりません");
  if (poll.reminderSentAt) throw new Error("すでにリマインドを送信済みです");
  if (!poll.deadlineAt) throw new Error("締切日時が未設定です");

  const claimed = await db
    .update(schedulePolls)
    .set({ reminderSentAt: new Date() })
    .where(
      and(eq(schedulePolls.id, pollId), isNull(schedulePolls.reminderSentAt)),
    )
    .returning();
  if (claimed.length === 0) throw new Error("すでにリマインドを送信済みです");

  const result = await sendReminder(db, poll, send);
  if (!result.ok) throw new Error(result.error ?? "送信に失敗しました");
  return result;
}

async function sendReminder(
  db: Db,
  poll: SchedulePoll,
  send?: SendFn,
): Promise<PollReminderResult[number]> {
  try {
    if (!poll.deadlineAt) {
      throw new Error("締切日時が未設定です(候補時点でチェック済みのはずが崩れています)");
    }
    const target = await requireMainGroup(db);
    await (send ?? pushMessages)(
      target.to,
      buildPollReminderMessages({
        title: poll.title,
        deadlineTime: formatJstTime(poll.deadlineAt),
        url: poll.chouseisanUrl,
      }),
      target.channel,
    );
    return { pollId: poll.id, title: poll.title, ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("poll reminder send failed", poll.id, e);
    return { pollId: poll.id, title: poll.title, ok: false, error: message };
  }
}
