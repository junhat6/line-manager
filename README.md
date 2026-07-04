# line-manager — 交流会運営支援システム

LINE日程調整で開催日を決めた**後**の定型作業を、抜け漏れなく進めるためのシステムです。

- 開催アナウンス(参加ボタン付き)の送信と参加者の自動集計
- 日程別LINEグループの案内
- 自己紹介スライドの記入依頼
- **前日15:00・当日9:00 の案内の自動送信**
- **終了後アンケートの自動送信**
- 「どこまで対応したか」が見えるチェックリスト

日々の運営手順は [docs/operations.md](docs/operations.md) を参照してください(引き継ぎ資料を兼ねます)。

## 設計の前提: LINE APIの制約

| やりたいこと | LINEの制約 | このシステムの解決策 |
|---|---|---|
| リアクションで参加集計 | ボットはリアクションを受信**できない** | Flex Messageの参加ボタン(postback)。タップすると本人の発言として「7/18(土) 参加します!」がグループに表示され、システムに自動記録される |
| グループの自動作成・招待 | ボットはグループを作成・招待**できない** | 運営者がグループを作りボットを招待。ボットはjoinイベントでグループを自動登録し、管理画面で日程に紐付ける |
| 定時送信 | pushは従量カウント | 送信は定型6種に限定。予約分はDBのキューに積み、外部cronが5分毎に叩く `/api/cron/tick` が期限到来分だけ送信(冪等) |

## 技術構成

- **Next.js (App Router) + TypeScript** — 管理画面 + Webhook + cron APIを1アプリに集約
- **Supabase Postgres + Drizzle ORM** — スキーマは `src/db/schema.ts` がコントラクト
- **@line/bot-sdk** — 署名検証とMessaging API
- **Basic認証**(`src/proxy.ts`) — 管理画面の保護。webhook/cronは各自の認証(署名 / CRON_SECRET)
- コントラクト層は `src/contracts/`(postbackデータ・フォーム入力・テンプレート変数のzodスキーマ)

```
LINEグループ ──webhook──▶ /api/line/webhook ──▶ 参加記録・グループ登録
運営者 ──Basic認証──▶ 管理画面 ──▶ 手動送信 / チェックリスト確認
cron-job.org ──5分毎──▶ /api/cron/tick ──▶ 期限到来した予約メッセージを送信
```

## セットアップ手順

### 1. LINE公式アカウント(Messaging APIチャネル)を作る

※ 現在はLINE Developersコンソールから直接チャネルを作れず、公式アカウント経由で作成します。

1. [LINE公式アカウントを作成](https://entry.line.biz/)し、[LINE Official Account Manager](https://manager.line.biz/) の 設定 → Messaging API から**Messaging APIを有効化**(このときプロバイダーを作成。後から変更不可)
2. [LINE Developersコンソール](https://developers.line.biz/console/) に作成されたチャネルで以下を取得する
   - **チャネルシークレット**(チャネル基本設定タブ) → `LINE_CHANNEL_SECRET`
   - **チャネルアクセストークン(長期)**(Messaging API設定タブで発行) → `LINE_CHANNEL_ACCESS_TOKEN`
3. [LINE公式アカウント管理画面](https://manager.line.biz/) で以下を設定する
   - 設定 → アカウント設定 → 機能の利用 → **「グループ・複数人チャットへの参加を許可する」を有効化**(これがないとグループに招待できません)
   - 応答設定 → **応答メッセージをオフ**(自動応答が交流会グループに流れるのを防ぐため)
   - ※ Webhookのトグルは**Webhook URL登録後(手順3の後)でないとオンにできない**ため、この時点では触らない

### 2. Supabase(データベース)を作る

1. [Supabase](https://supabase.com/) でプロジェクト作成(リージョンは Tokyo 推奨)
2. Connect → **Transaction pooler** の接続文字列を取得 → `DATABASE_URL`
   (pgbouncer経由のためアプリは prepared statements を使わない設定になっています)
3. マイグレーションを適用:

```bash
DATABASE_URL="postgresql://..." npm run db:migrate
```

### 3. Vercelにデプロイ

1. このリポジトリをGitHubにpushし、Vercelでインポート
2. 環境変数を設定(`.env.example` 参照):
   `DATABASE_URL` / `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` / `ADMIN_USER` / `ADMIN_PASSWORD` / `CRON_SECRET`
   (`CRON_SECRET` は `openssl rand -hex 32` などで生成したランダム文字列)
3. デプロイ後、LINE DevelopersコンソールのMessaging API設定で
   **Webhook URL** に `https://<デプロイ先>/api/line/webhook` を設定し、「検証」が成功することを確認。**Webhookの利用をオン**にする

### 4. 定時送信のcronを登録

前日15:00・当日9:00・アンケートの自動送信は、外部から `/api/cron/tick` を定期的に叩くことで動きます。

[cron-job.org](https://cron-job.org/)(無料)で以下のジョブを登録:

- URL: `https://<デプロイ先>/api/cron/tick`
- 間隔: **5分毎**
- リクエストヘッダー: `Authorization: Bearer <CRON_SECRET>`

> **なぜVercel Cronではないのか**: Vercelの無料(Hobby)プランのcronは1日1回・最大1時間の遅延があり、「前日15:00」の定時性を満たせません。5分間隔の外部cronなら誤差は最大5分で、副次効果としてSupabase無料枠の「1週間無操作で一時停止」も回避できます。

### 5. 初期設定(管理画面)

1. メインのLINEグループ(全体アナウンス用)にボットを招待
2. 管理画面の **グループ** ページに自動で現れるので、役割を **メイン** に設定
3. **設定** ページでアンケートURLを確認(要件の定型URLがデフォルトで入っています)

## ローカル開発

```bash
cp .env.example .env.local   # 値を埋める
npm install
npm run dev                  # http://localhost:3000 (Basic認証あり)
```

Webhookの実機確認はトンネル(例: `ngrok http 3000`)を張り、そのURLをLINE DevelopersのWebhook URLに一時設定します。
cronを待たずに送信テストをするには:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick
```

```bash
npm test           # ユニットテスト(PGliteで送信キューの冪等性まで検証)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run db:generate  # スキーマ変更後のマイグレーション生成
```

## メッセージ数(料金)の注意

LINEのpushメッセージは**グループ宛でもグループ人数分**が月間メッセージ数にカウントされます([公式の解説](https://developers.line.biz/ja/tips/2026/05/28/how-to-count-messages/))。無料のコミュニケーションプランは月200通です。

36人メイングループ + 日程別グループ各18人・月1開催の概算:

| 送信 | 宛先 | 概算 |
|---|---|---:|
| 開催アナウンス | メイン(36人) | 36 |
| グループ案内 ×2日程 | メイン(36人) | 72 |
| スライド案内 ×2 | 日程別(18人) | 36 |
| 前日案内 ×2 | 日程別(18人) | 36 |
| 当日案内 ×2 | 日程別(18人) | 36 |
| アンケート ×2 | 日程別(18人) | 36 |
| **合計** | | **約252** |

**無料枠を超える可能性があります。** 対策:

- スライド案内は前日案内にもスライドURLが入るため、**省略すると▲36通**(手動送信なので送らなければカウントされません)
- 参加ボタンのタップへの反応はpostbackのdisplayText(カウント対象外)で実現しており、通数を消費しません
- それでも超える場合はライトプラン(月5,000通)への変更を検討してください(最新の料金は[公式ページ](https://developers.line.biz/ja/docs/messaging-api/pricing/)で確認)

運用開始月は [LINE公式アカウント管理画面](https://manager.line.biz/) でメッセージ数の実測値を確認してください。
