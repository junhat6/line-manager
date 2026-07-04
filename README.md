# line-manager — 交流会運営支援システム

交流会運営の定型作業を、日程調整から抜け漏れなく進めるためのシステムです。

- **日程調整の自動化**: 調整さん(chouseisan.com)に来月全日程の出欠表を作成してグループに投稿し、集計上位2日程でイベントを自動作成
- 開催アナウンス(参加ボタン付き)の送信と参加者の自動集計
- 日程別LINEグループの案内
- 自己紹介スライドの記入依頼
- **前日15:00・当日9:00 の案内の自動送信**
- **終了後アンケートの自動送信**
- 「どこまで対応したか」が見えるチェックリスト
- 複数LINEチャネル対応(無料枠のグループ分散)とチャネル別の消費量表示

日々の運営手順は [docs/operations.md](docs/operations.md) を参照してください(引き継ぎ資料を兼ねます)。

## 設計の前提: LINE APIの制約

| やりたいこと | LINEの制約 | このシステムの解決策 |
|---|---|---|
| リアクションで参加集計 | ボットはリアクションを受信**できない** | Flex Messageの参加ボタン(postback)。タップするとトークには何も流れずにシステムへ自動記録される(LINE標準の投票と同じ静かな挙動) |
| グループの自動作成・招待 | ボットはグループを作成・招待**できない** | 運営者がグループを作りボットを招待。ボットはjoinイベントでグループを自動登録し、管理画面で日程に紐付ける |
| 定時送信 | pushは従量カウント | 送信は定型に限定。予約分はDBのキューに積み、外部cronが5分毎に叩く `/api/cron/tick` が期限到来分だけ送信(冪等) |
| LINE標準の日程調整・投票 | ボットから投稿**できない**(Messaging APIに該当メッセージタイプが無い) | 調整さん(chouseisan.com)を利用。URLならボットが投稿でき、出欠表CSVから集計もできる |
| 無料枠 月200通の超過 | 1グループに同居できるボットは実質1つ(切替は退出・再招待の手作業) | **グループ分散**: メイングループはチャネル1、日程別グループはチャネル2のボットが担当。グループ↔チャネルはjoinイベントで自動記録され、送信時に自動で使い分ける |

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

36人メイングループ + 日程別グループ各18人・月1開催・1ボット構成だと**約290通(日程調整投稿込み)で枠を超過**します。そのため**2チャネルのグループ分散**を推奨します:

| 送信 | 宛先 | 担当 | 概算 |
|---|---|---|---:|
| 日程調整URL投稿 | メイン(36人) | チャネル1 | 36 |
| 開催アナウンス | メイン(36人) | チャネル1 | 36 |
| グループ案内 ×2日程 | メイン(36人) | チャネル1 | 72 |
| スライド案内 ×2 | 日程別(18人) | チャネル2 | 36 |
| 前日案内 ×2 | 日程別(18人) | チャネル2 | 36 |
| 当日案内 ×2 | 日程別(18人) | チャネル2 | 36 |
| アンケート ×2 | 日程別(18人) | チャネル2 | 36 |
| **合計** | | チャネル1: **144** / チャネル2: **144** | |

どちらのチャネルも月200通の無料枠に収まります。さらに節約する場合:

- スライド案内は前日案内にもスライドURLが入るため、**省略すると▲36通**(手動送信なので送らなければカウントされません)
- 参加ボタンのタップはpostbackのみで、メッセージを送らないため通数を消費しません
- それでも超える場合はライトプラン(月5,000通)への変更を検討してください(最新の料金は[公式ページ](https://developers.line.biz/ja/docs/messaging-api/pricing/)で確認)

当月の実測値は管理画面の**設定ページ**(チャネル別に表示)または [LINE公式アカウント管理画面](https://manager.line.biz/) で確認できます。

## チャネルを増やす(グループ分散)

1. **チャネル1と同一プロバイダー配下**に2つ目のMessaging APIチャネル(公式アカウント)を作成する
   ※ LINEのuserIdはプロバイダー単位のため、別プロバイダーだと同じ人が別人として二重登録されます。プロバイダーは作成後に変更できないので必ず確認してください
2. セットアップ手順1と同様にトークンとシークレットを取得し、環境変数 `LINE_CHANNEL_2_ACCESS_TOKEN` / `LINE_CHANNEL_2_SECRET` に設定する(3つ目以降も同じ規則で `LINE_CHANNEL_3_*` …)
3. Webhook URLに `https://<デプロイ先>/api/line/webhook?channel=2` を設定して「検証」→ **Webhookの利用をオン**にする
4. 日程別グループには**チャネル2のボット**を招待する(メイングループはチャネル1のまま)。グループがどのチャネルの担当かは管理画面のグループページに表示され、送信時は自動で使い分けられます

## 日程調整(調整さん連携)

管理画面の**日程調整**ページから:

1. **「+ 来月の日程調整を開始」** — 調整さんに来月の全日程を候補にした出欠表を自動作成し、URLをメイングループにLINE投稿します
2. メンバーは調整さんで ◯/△/× を入力(LINEログイン等は不要)
3. **「結果を取り込んでイベント作成」** — 出欠表を集計(◯=1点・△=0.5点、同点は早い日付優先)し、上位2日程・19:00開始のイベントを自動作成します(開始時刻は日程カードで変更可能)

> **注意**: 調整さんには公式APIが無いため、この連携はWebページと同じリクエストを送る方式です。調整さん側の仕様変更で動かなくなる可能性があり、その場合は具体的なエラーが表示されます(手動での日程調整運用にフォールバックしてください)。
