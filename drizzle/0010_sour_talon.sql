CREATE TABLE "line_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_group_id" text NOT NULL,
	"line_user_id" text NOT NULL,
	"display_name" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "line_group_members_line_group_id_line_user_id_unique" UNIQUE("line_group_id","line_user_id")
);
