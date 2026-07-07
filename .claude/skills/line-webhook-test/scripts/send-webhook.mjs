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
    "group-id": { type: "string", default: "C0000000000000000000000000000000" },
    "user-id": { type: "string", default: "U0000000000000000000000000000000" },
    url: { type: "string" },
    channel: { type: "string", default: "1" },
    "dry-run": { type: "boolean", default: false },
  },
});

function fail(msg) {
  console.error(`エラー: ${msg}`);
  process.exit(1);
}

if (!["join", "leave"].includes(args.type ?? "")) {
  fail("--type は join | leave のいずれかを指定してください");
}
const channel = Number.parseInt(args.channel, 10);
if (!Number.isInteger(channel) || channel < 1) {
  fail("--channel は 1 以上の整数を指定してください");
}
// --url 未指定なら、チャネル2以降は本番と同じく ?channel=N を付けて送る
const url =
  args.url ??
  `http://localhost:3000/api/line/webhook${channel >= 2 ? `?channel=${channel}` : ""}`;

// チャネル1は基本名、2以降は連番付きの環境変数(src/lib/line/channels.ts と同じ規約)
const secretKey =
  channel === 1 ? "LINE_CHANNEL_SECRET" : `LINE_CHANNEL_${channel}_SECRET`;

// サーバー(Next.js は .env / .env.local を自動読込)と同じ値を使うため、
// 環境変数 → .env.local → .env の順で探す
function loadChannelSecret() {
  if (process.env[secretKey]) return process.env[secretKey];
  for (const name of [".env.local", ".env"]) {
    try {
      const text = readFileSync(resolve(projectRoot, name), "utf8");
      const m = text.match(new RegExp(`^${secretKey}=(.+)$`, "m"));
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
  fail(`${secretKey} が見つかりません(.env.local / .env / 環境変数)`);
}

const base = {
  mode: "active",
  timestamp: Date.now(),
  webhookEventId: `test-${crypto.randomUUID()}`,
  deliveryContext: { isRedelivery: false },
};

const event = {
  ...base,
  type: args.type,
  source: { type: "group", groupId: args["group-id"] },
};

const body = JSON.stringify({ destination: args["user-id"], events: [event] });
const signature = crypto.createHmac("sha256", secret).update(body).digest("base64");

if (args["dry-run"]) {
  console.log("=== dry-run(送信しません) ===");
  console.log(`URL: ${url}`);
  console.log(`x-line-signature: ${signature}`);
  console.log("body:");
  console.log(JSON.stringify(JSON.parse(body), null, 2));
  process.exit(0);
}

const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-line-signature": signature },
  body,
}).catch((e) => fail(`サーバーに接続できません(npm run dev は起動していますか?): ${e.message}`));

const text = await res.text();
console.log(`HTTP ${res.status}: ${text}`);
if (res.status === 401) {
  console.error(`→ 署名不一致。サーバーとこのスクリプトで ${secretKey} が食い違っています`);
  process.exit(1);
}
if (!res.ok) process.exit(1);
