CREATE TYPE "public"."poll_status" AS ENUM('open', 'imported');--> statement-breakpoint
CREATE TABLE "schedule_polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"chouseisan_url" text NOT NULL,
	"target_month" timestamp with time zone NOT NULL,
	"status" "poll_status" DEFAULT 'open' NOT NULL,
	"posted_at" timestamp with time zone,
	"imported_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "line_groups" ADD COLUMN "channel" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_polls" ADD CONSTRAINT "schedule_polls_imported_event_id_events_id_fk" FOREIGN KEY ("imported_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;