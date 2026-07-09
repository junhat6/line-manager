ALTER TABLE "schedule_polls" ADD COLUMN "deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedule_polls" ADD COLUMN "deadline_handled_at" timestamp with time zone;