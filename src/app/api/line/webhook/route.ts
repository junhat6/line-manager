import { validateSignature, type webhook } from "@line/bot-sdk";
import { getDb } from "@/db/client";
import { getEnv } from "@/lib/env";
import { handleWebhookEvent } from "@/lib/line/webhook";

export async function POST(req: Request): Promise<Response> {
  // 署名検証には生のボディが必要(パース後のJSONでは検証できない)
  const body = await req.text();
  const signature = req.headers.get("x-line-signature");
  if (
    !signature ||
    !validateSignature(body, getEnv().LINE_CHANNEL_SECRET, signature)
  ) {
    return new Response("invalid signature", { status: 401 });
  }

  const callback = JSON.parse(body) as webhook.CallbackRequest;
  const db = getDb();

  // 1イベントの失敗で全体を500にしない。500を返すとLINEが成功済みイベントごと
  // 再配送してくるため、部分的な失敗はログに留めて200を返す
  for (const event of callback.events ?? []) {
    try {
      await handleWebhookEvent(db, event);
    } catch (e) {
      console.error("webhook event handling failed", event.type, e);
    }
  }

  return Response.json({ ok: true });
}
