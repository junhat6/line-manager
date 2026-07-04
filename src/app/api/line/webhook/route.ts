import { validateSignature, type webhook } from "@line/bot-sdk";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getLineChannels } from "@/lib/line/channels";
import { handleWebhookEvent } from "@/lib/line/webhook";

// チャネル識別は ?channel=N のクエリで明示する(デフォルト1)。
// 全secret総当たりやdestination(ボットのuserId)での判別は、設定ミスしても
// 「なんとなく動いてしまう」ため不採用 — URL登録を間違えたら署名検証で確実に落とす。
const channelParam = z.coerce.number().int().min(1).default(1);

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = channelParam.safeParse(
    req.nextUrl.searchParams.get("channel") ?? undefined,
  );
  if (!parsed.success) {
    return new Response("invalid channel", { status: 400 });
  }
  const channel = parsed.data;

  const creds = getLineChannels().get(channel);
  if (!creds) {
    return new Response("unknown channel", { status: 404 });
  }

  // 署名検証には生のボディが必要(パース後のJSONでは検証できない)
  const body = await req.text();
  const signature = req.headers.get("x-line-signature");
  if (!signature || !validateSignature(body, creds.secret, signature)) {
    return new Response("invalid signature", { status: 401 });
  }

  const callback = JSON.parse(body) as webhook.CallbackRequest;
  const db = getDb();

  // 1イベントの失敗で全体を500にしない。500を返すとLINEが成功済みイベントごと
  // 再配送してくるため、部分的な失敗はログに留めて200を返す
  for (const event of callback.events ?? []) {
    try {
      await handleWebhookEvent(db, event, channel);
    } catch (e) {
      console.error("webhook event handling failed", event.type, e);
    }
  }

  return Response.json({ ok: true });
}
