ALTER TABLE "events" ADD COLUMN "public_token" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_public_token_unique" UNIQUE("public_token");