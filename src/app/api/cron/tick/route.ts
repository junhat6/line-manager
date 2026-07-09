import { getDb } from "@/db/client";
import { getEnv } from "@/lib/env";
import { checkPollDeadlines } from "@/lib/poll-deadline";
import { checkPollReminders } from "@/lib/poll-reminder";
import { runTick } from "@/lib/tick";

export const dynamic = "force-dynamic";

/**
 * 外部cron(cron-job.org等)から5分間隔で叩かれるエンドポイント。
 * 期限到来した予約メッセージ(前日案内・当日案内・アンケート)の送信、
 * 締切当日の日程調整リマインドのメイングループ投稿、
 * 締切超過した日程調整の自動取込(+Slack通知)を行う。
 * 定期的なDBアクセスがSupabase無料枠の自動一時停止の回避も兼ねる。
 */
export async function GET(req: Request): Promise<Response> {
  const secret = getEnv().CRON_SECRET;
  const header = req.headers.get("authorization");
  const query = new URL(req.url).searchParams.get("secret");
  if (header !== `Bearer ${secret}` && query !== secret) {
    return new Response("unauthorized", { status: 401 });
  }

  const db = getDb();
  const tick = await runTick(db);
  const pollReminders = await checkPollReminders(db);
  const pollDeadlines = await checkPollDeadlines(db);
  if (
    tick.results.length > 0 ||
    tick.staleFailed > 0 ||
    pollReminders.length > 0 ||
    pollDeadlines.length > 0
  ) {
    console.log(
      "cron tick",
      JSON.stringify({ tick, pollReminders, pollDeadlines }),
    );
  }
  return Response.json({ tick, pollReminders, pollDeadlines });
}
