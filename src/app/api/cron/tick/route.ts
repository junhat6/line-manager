import { getDb } from "@/db/client";
import { getEnv } from "@/lib/env";
import { runTick } from "@/lib/tick";

export const dynamic = "force-dynamic";

/**
 * 外部cron(cron-job.org等)から5分間隔で叩かれるエンドポイント。
 * 期限到来した予約メッセージ(前日案内・当日案内・アンケート)を送信する。
 * 定期的なDBアクセスがSupabase無料枠の自動一時停止の回避も兼ねる。
 */
export async function GET(req: Request): Promise<Response> {
  const secret = getEnv().CRON_SECRET;
  const header = req.headers.get("authorization");
  const query = new URL(req.url).searchParams.get("secret");
  if (header !== `Bearer ${secret}` && query !== secret) {
    return new Response("unauthorized", { status: 401 });
  }

  const result = await runTick(getDb());
  if (result.results.length > 0 || result.staleFailed > 0) {
    console.log("cron tick", JSON.stringify(result));
  }
  return Response.json(result);
}
