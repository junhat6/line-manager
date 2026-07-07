---
name: line-webhook-test
description: LINE webhook(join/leave)の署名付き偽装リクエストをローカル開発サーバーに送信して動作確認する。実 LINE チャネルや ngrok は不要
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

# 送信せずペイロードと署名だけ確認する
node .claude/skills/line-webhook-test/scripts/send-webhook.mjs --type join --dry-run
```

オプション: `--group-id`(既定はダミー ID)、`--url`(既定は localhost:3000)、
`--channel N`(既定は 1。シークレットを `LINE_CHANNEL_N_SECRET` から読み、
`--url` 未指定なら本番と同じく `?channel=N` を付けて送る。マルチチャネル構成のテスト用)

## 期待される挙動と注意

- LINE グループ名の取得(`getGroupSummary`)はダミートークンでは失敗するが、
  ハンドラが catch して続行する設計。グループ名は null で記録される
- 401 が返る場合はスクリプトとサーバーで `LINE_CHANNEL_SECRET` が食い違っている
- テスト後は `line_groups` に入ったダミーデータを
  `npm run db:studio` で確認・掃除できる
