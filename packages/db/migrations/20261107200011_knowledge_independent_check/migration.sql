CREATE TABLE "knowledge"."check_start" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"route_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "check_start_route_id_format" CHECK ("route_id" ~ '^[a-z]{2}-[a-z0-9][a-z0-9-]{0,62}$'),
	CONSTRAINT "check_start_version_number_positive" CHECK ("version_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "knowledge"."check_start" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "knowledge"."independent_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"start_id" uuid NOT NULL CONSTRAINT "independent_check_start_id_key" UNIQUE,
	"route_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"content_hash" text NOT NULL,
	"guide_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"items" jsonb NOT NULL,
	"fetch_log" jsonb NOT NULL,
	"failure" text,
	"failed" boolean NOT NULL,
	"clean" boolean NOT NULL,
	CONSTRAINT "independent_check_route_id_format" CHECK ("route_id" ~ '^[a-z]{2}-[a-z0-9][a-z0-9-]{0,62}$'),
	CONSTRAINT "independent_check_version_number_positive" CHECK ("version_number" > 0),
	CONSTRAINT "independent_check_content_hash_format" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "independent_check_guide_hash_format" CHECK ("guide_hash" = 'none' OR "guide_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "independent_check_prompt_version_format" CHECK ("prompt_version" ~ '^[a-z0-9][a-z0-9.-]{0,63}$'),
	CONSTRAINT "independent_check_model_format" CHECK ("model" ~ '^[a-z0-9][a-z0-9.-]{0,63}$'),
	CONSTRAINT "independent_check_failure_format" CHECK ("failure" IS NULL OR "failure" ~ '^[a-z][a-z_]{0,39}$'),
	CONSTRAINT "independent_check_items_array" CHECK (jsonb_typeof("items") = 'array' AND jsonb_array_length("items") <= 200),
	CONSTRAINT "independent_check_fetch_log_array" CHECK (jsonb_typeof("fetch_log") = 'array' AND jsonb_array_length("fetch_log") <= 200),
	CONSTRAINT "independent_check_clean" CHECK ("clean" = ("model" <> 'fake'
        AND jsonb_array_length("items") > 0
        AND NOT jsonb_path_exists("items", '$[*] ? (!exists(@.status ? (@ == "matches")))')))
);
--> statement-breakpoint
ALTER TABLE "knowledge"."independent_check" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "check_start_started_at_idx" ON "knowledge"."check_start" ("started_at");--> statement-breakpoint
CREATE INDEX "independent_check_version_idx" ON "knowledge"."independent_check" ("route_id","version_number");--> statement-breakpoint
CREATE POLICY "check_start_read" ON "knowledge"."check_start" AS PERMISSIVE FOR SELECT TO "app_api" USING (true);--> statement-breakpoint
CREATE POLICY "check_start_insert" ON "knowledge"."check_start" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "independent_check_read" ON "knowledge"."independent_check" AS PERMISSIVE FOR SELECT TO "app_api", "app_auth", "app_jobs" USING (true);--> statement-breakpoint
CREATE POLICY "independent_check_insert" ON "knowledge"."independent_check" AS PERMISSIVE FOR INSERT TO "app_jobs" WITH CHECK (true);