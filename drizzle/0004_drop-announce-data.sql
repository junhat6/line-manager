-- 開催アナウンス(参加ボタン)機能の削除に伴うデータ前処理。
-- 次のマイグレーションで enum から 'announce' / 'announced' を除去し
-- scheduled_messages.session_id を NOT NULL にするため、
-- 該当する値を持つ行を先に消し込んでおく(残っていると型変換で失敗する)。
DELETE FROM "scheduled_messages" WHERE "kind" = 'announce';--> statement-breakpoint
UPDATE "events" SET "status" = 'draft' WHERE "status" = 'announced';
