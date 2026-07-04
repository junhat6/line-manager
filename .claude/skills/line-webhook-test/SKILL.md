---
name: line-webhook-test
description: LINE webhook(join/leave/postback)の署名付き偽装リクエストをローカル開発サーバーに送信して動作確認する。実 LINE チャネルや ngrok は不要
---

# LINE Webhook ローカルテスト

`LINE_CHANNEL_SECRET` で HMAC-SHA256 署名した webhook ペイロードを
ローカルの `/api/line/webhook` に POST し、実チャネルなしで bot ロジックをテストする。

**この仕組みが成立する理由**: `src/app/api/line/webhook/route.ts` の署名検証は
「生ボディ + チャネルシークレット」の HMAC 一致だけを見ている。つまりシークレットさえ
一致すれば、LINE のサーバーからでなくても正規のリクエストとして処理される。
ローカルでは `.env.local` にダミーのシークレットを置けばよい。

## 前提

- 開発サーバーが起動していること(`npm run dev`、既定で http://localhost:3000)
- `.env`(または `.env.local`)に `LINE_CHANNEL_SECRET` が設定されていること
  (サーバーとスクリプトが同じ値を読むので、ダミー値で構わない)
- DB(`DATABASE_URL`)に接続できること — イベント処理は DB 書き込みを伴う

## 使い方

```bash
# グループ参加イベント(line_groups に upsert される)
node .claude/skills/line-webhook-test/scripts/send-webhook.mjs --type join

# グループ退出イベント(line_groups.active が false になる)
node .claude/skills/line-webhook-test/scripts/send-webhook.mjs --type leave

# 参加ボタンの postback(attendances に upsert される)
node .claude/skills/line-webhook-test/scripts/send-webhook.mjs \
  --type postback --action attend --session-id <実在する sessions.id の UUID>

# 取消ボタン
node .claude/skills/line-webhook-test/scripts/send-webhook.mjs \
  --type postback --action cancel --session-id <UUID>

# 送信せずペイロードと署名だけ確認する
node .claude/skills/line-webhook-test/scripts/send-webhook.mjs --type join --dry-run
```

オプション: `--group-id` / `--user-id`(既定はダミー ID)、`--url`(既定は localhost:3000)

## 期待される挙動と注意

- **postback の `--session-id` は DB に実在する UUID を渡すこと**。
  存在しない ID はハンドラが黙って無視する仕様(`handlePostback` 参照)なので、
  200 が返っても attendances には何も書かれない
- LINE プロフィール API の呼び出し(`getGroupSummary` / `getProfile`)はダミートークンでは
  失敗するが、ハンドラが catch して続行する設計。メンバーは `(名前未取得)` で作成される
- 401 が返る場合はスクリプトとサーバーで `LINE_CHANNEL_SECRET` が食い違っている
- テスト後は `line_groups` / `members` / `attendances` に入ったダミーデータを
  `npm run db:studio` で確認・掃除できる
