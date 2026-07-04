---
name: create-migration
description: Drizzle スキーマ変更から SQL マイグレーションを生成し、データ喪失リスクをレビューしてから適用する
disable-model-invocation: true
---

# Drizzle マイグレーション作成

`src/db/schema.ts` の変更から SQL マイグレーションを安全に生成・適用する手順。

**この手順が存在する理由**: `drizzle-kit generate` はスキーマ差分から SQL を自動生成するが、
カラムのリネームを「DROP + ADD」と解釈するなど、**データ喪失を伴う SQL を黙って生成することがある**。
生成された SQL のレビューを飛ばして適用すると、本番データが消える。

## 手順

1. **スキーマ変更を確認する**
   - `git diff src/db/schema.ts` で変更内容を把握する
   - 変更がなければユーザーに「schema.ts に変更がありません」と伝えて終了

2. **マイグレーションを生成する**(DATABASE_URL 不要)
   ```bash
   npm run db:generate
   ```
   - リネームか DROP+ADD かを対話で聞かれた場合は、ユーザーに確認してから答える

3. **生成された SQL を必ずレビューする**
   - `drizzle/` 配下に新しく生成された `.sql` ファイルを読む
   - 以下があれば **危険** としてユーザーに明示的に提示し、適用してよいか確認する:
     - `DROP TABLE` / `DROP COLUMN`(データ喪失)
     - `ALTER COLUMN ... TYPE`(キャスト失敗で適用エラーになりうる)
     - `NOT NULL` 追加(既存行に NULL があると失敗する。DEFAULT の有無を確認)
   - 危険がなければ SQL の要約をユーザーに見せる

4. **適用する**(DATABASE_URL 必要 — `.env` に Supabase の接続文字列が設定済みであること)
   ```bash
   npm run db:migrate
   ```
   - 接続エラーの場合は `.env` の `DATABASE_URL` が未設定の可能性を伝える

5. **検証する**
   ```bash
   npm run test
   ```
   - スキーマを参照するテストは PGlite で実行されるため、マイグレーション適用後に通ることを確認

## 注意

- `drizzle/meta/` 配下のスナップショットは drizzle-kit の管理ファイル。手で編集しない
- 生成済みマイグレーションファイルの編集も禁止(適用済み環境とハッシュがずれる)。
  修正したい場合は新しいマイグレーションを追加する
