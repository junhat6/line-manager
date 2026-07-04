import { and, asc, eq, isNotNull, lt, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { scheduledMessages } from "@/db/schema";
import {
  sendScheduledMessage,
  type SendFn,
  type SendResult,
} from "@/lib/send";

/** sending のまま止まっている行を中断とみなすまでの時間 */
const STALE_SENDING_MS = 15 * 60 * 1000;

export type TickResult = {
  staleFailed: number;
  results: SendResult[];
};

/**
 * 期限が来た pending 行を送信する。冪等:
 * - claim(pending→sending)が原子的なので、tickが重複起動しても各行は一度しか送られない
 * - 送信対象がなければ何もしない
 * 5分間隔の外部cronから叩かれる前提。
 */
export async function runTick(
  db: Db,
  opts: { now?: Date; send?: SendFn } = {},
): Promise<TickResult> {
  const now = opts.now ?? new Date();

  // claim後にプロセスが落ちた行の回収。failedにしてチェックリストで気づけるようにする
  const stale = await db
    .update(scheduledMessages)
    .set({
      status: "failed",
      error: "送信処理が中断されました。内容を確認して再送信してください",
    })
    .where(
      and(
        eq(scheduledMessages.status, "sending"),
        lt(scheduledMessages.claimedAt, new Date(now.getTime() - STALE_SENDING_MS)),
      ),
    )
    .returning({ id: scheduledMessages.id });

  const due = await db
    .select({ id: scheduledMessages.id })
    .from(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.status, "pending"),
        isNotNull(scheduledMessages.scheduledAt),
        lte(scheduledMessages.scheduledAt, now),
      ),
    )
    .orderBy(asc(scheduledMessages.scheduledAt));

  const results: SendResult[] = [];
  for (const { id } of due) {
    const result = await sendScheduledMessage(db, id, { send: opts.send });
    if (result) results.push(result);
  }

  return { staleFailed: stale.length, results };
}
