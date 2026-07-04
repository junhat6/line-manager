#!/usr/bin/env node
/**
 * LINE webhook の偽装リクエストを署名付きでローカルサーバーに送る。
 * 署名検証(HMAC-SHA256)はチャネルシークレットの一致だけを見るため、
 * .env のダミーシークレットで正規リクエストとして処理させられる。
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const { values: args } = parseArgs({
  options: {
    type: { type: "string" },
    action: { type: "string", default: "attend" },
    "session-id": { type: "string" },
    "group-id": { type: "string", default: "C0000000000000000000000000000000" },
    "user-id": { type: "string", default: "U0000000000000000000000000000000" },
    url: { type: "string", default: "http://localhost:3000/api/line/webhook" },
    "dry-run": { type: "boolean", default: false },
  },
});

function fail(msg) {
  console.error(`エラー: ${msg}`);
  process.exit(1);
}

if (!["join", "leave", "postback"].includes(args.type ?? "")) {
  fail("--type は join | leave | postback のいずれかを指定してください");
}
if (args.type === "postback") {
  if (!args["session-id"]) fail("--type postback には --session-id <UUID> が必要です");
  if (!["attend", "cancel"].includes(args.action)) {
    fail("--action は attend | cancel のいずれかを指定してください");
  }
}

// サーバー(Next.js は .env / .env.local を自動読込)と同じ値を使うため、
// 環境変数 → .env.local → .env の順で探す
function loadChannelSecret() {
  if (process.env.LINE_CHANNEL_SECRET) return process.env.LINE_CHANNEL_SECRET;
  for (const name of [".env.local", ".env"]) {
    try {
      const text = readFileSync(resolve(projectRoot, name), "utf8");
      const m = text.match(/^LINE_CHANNEL_SECRET=(.+)$/m);
      if (m) {
        const v = m[1].trim().replace(/^["']|["']$/g, "");
        if (v) return v;
      }
    } catch {
      // ファイルがなければ次を試す
    }
  }
  return null;
}

const secret = loadChannelSecret();
if (!secret) {
  fail("LINE_CHANNEL_SECRET が見つかりません(.env.local / .env / 環境変数)");
}

const base = {
  mode: "active",
  timestamp: Date.now(),
  webhookEventId: `test-${crypto.randomUUID()}`,
  deliveryContext: { isRedelivery: false },
};

let event;
switch (args.type) {
  case "join":
    event = { ...base, type: "join", source: { type: "group", groupId: args["group-id"] } };
    break;
  case "leave":
    event = { ...base, type: "leave", source: { type: "group", groupId: args["group-id"] } };
    break;
  case "postback":
    event = {
      ...base,
      type: "postback",
      source: { type: "group", groupId: args["group-id"], userId: args["user-id"] },
      replyToken: "0".repeat(32),
      postback: {
        data: JSON.stringify({ action: args.action, sessionId: args["session-id"] }),
      },
    };
    break;
}

const body = JSON.stringify({ destination: args["user-id"], events: [event] });
const signature = crypto.createHmac("sha256", secret).update(body).digest("base64");

if (args["dry-run"]) {
  console.log("=== dry-run(送信しません) ===");
  console.log(`URL: ${args.url}`);
  console.log(`x-line-signature: ${signature}`);
  console.log("body:");
  console.log(JSON.stringify(JSON.parse(body), null, 2));
  process.exit(0);
}

const res = await fetch(args.url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-line-signature": signature },
  body,
}).catch((e) => fail(`サーバーに接続できません(npm run dev は起動していますか?): ${e.message}`));

const text = await res.text();
console.log(`HTTP ${res.status}: ${text}`);
if (res.status === 401) {
  console.error("→ 署名不一致。サーバーとこのスクリプトで LINE_CHANNEL_SECRET が食い違っています");
  process.exit(1);
}
if (!res.ok) process.exit(1);
