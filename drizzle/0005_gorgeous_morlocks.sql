ALTER TABLE "attendances" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "members" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "attendances" CASCADE;--> statement-breakpoint
DROP TABLE "members" CASCADE;--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_public_token_unique";--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "status" SET DEFAULT 'draft'::text;--> statement-breakpoint
DROP TYPE "public"."event_status";--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'done');--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."event_status";--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "status" SET DATA TYPE "public"."event_status" USING "status"::"public"."event_status";--> statement-breakpoint
ALTER TABLE "scheduled_messages" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."message_kind";--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('group_invite', 'slide_request', 'day_before', 'day_of', 'survey');--> statement-breakpoint
ALTER TABLE "scheduled_messages" ALTER COLUMN "kind" SET DATA TYPE "public"."message_kind" USING "kind"::"public"."message_kind";--> statement-breakpoint
ALTER TABLE "scheduled_messages" ALTER COLUMN "session_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "public_token";--> statement-breakpoint
DROP TYPE "public"."attendance_source";--> statement-breakpoint
DROP TYPE "public"."attendance_status";