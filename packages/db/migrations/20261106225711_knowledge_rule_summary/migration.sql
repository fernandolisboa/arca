CREATE TABLE "knowledge"."rule_summary" (
	"content_hash" text,
	"prompt_version" text,
	"model" text,
	"overview" text NOT NULL,
	"watch_points" text[] NOT NULL,
	CONSTRAINT "rule_summary_pkey" PRIMARY KEY("content_hash","prompt_version","model"),
	CONSTRAINT "rule_summary_content_hash_format" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "rule_summary_prompt_version_format" CHECK ("prompt_version" ~ '^[a-z0-9][a-z0-9.-]{0,63}$'),
	CONSTRAINT "rule_summary_model_format" CHECK ("model" ~ '^[a-z0-9][a-z0-9.-]{0,63}$'),
	CONSTRAINT "rule_summary_overview_length" CHECK (char_length("overview") BETWEEN 1 AND 1500),
	CONSTRAINT "rule_summary_watch_points_count" CHECK (coalesce(array_length("watch_points", 1), 0) <= 8)
);
--> statement-breakpoint
ALTER TABLE "knowledge"."rule_summary" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "rule_summary_read" ON "knowledge"."rule_summary" AS PERMISSIVE FOR SELECT TO "app_api" USING (true);--> statement-breakpoint
CREATE POLICY "rule_summary_insert" ON "knowledge"."rule_summary" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK (true);