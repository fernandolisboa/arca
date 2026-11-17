CREATE TABLE "knowledge"."rule_verdict" (
	"cache_key" text PRIMARY KEY,
	"verdict" text NOT NULL,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "rule_verdict_cache_key_format" CHECK ("cache_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "rule_verdict_verdict" CHECK ("verdict" IN ('supports', 'contradicts', 'cannot_tell'))
);
--> statement-breakpoint
ALTER TABLE "knowledge"."rule_verdict" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "knowledge"."update_end" (
	"request_id" uuid PRIMARY KEY,
	"failure" text,
	"content_hash" text,
	"proposal" jsonb,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "update_end_shape" CHECK (CASE WHEN "failure" IS NULL
        THEN "proposal" IS NOT NULL AND "content_hash" ~ '^[0-9a-f]{64}$'
        ELSE "failure" ~ '^[a-z][a-z_]{0,63}$' AND "proposal" IS NULL AND "content_hash" IS NULL END),
	CONSTRAINT "update_end_proposal_size" CHECK ("proposal" IS NULL OR octet_length("proposal"::text) <= 2000000)
);
--> statement-breakpoint
ALTER TABLE "knowledge"."update_end" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "knowledge"."update_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"route_id" text NOT NULL,
	"base_number" integer NOT NULL,
	"requested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "update_request_route_id_format" CHECK ("route_id" ~ '^[a-z]{2}-[a-z0-9][a-z0-9-]{0,62}$'),
	CONSTRAINT "update_request_base_number_positive" CHECK ("base_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "knowledge"."update_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "knowledge"."update_stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"request_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"stage" text NOT NULL,
	"failure" text,
	"needs_correction" boolean,
	"proposal_valid" boolean,
	"output" jsonb,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"web_searches" integer,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "update_stage_request_position_key" UNIQUE("request_id","position"),
	CONSTRAINT "update_stage_position" CHECK ("position" BETWEEN 0 AND 3),
	CONSTRAINT "update_stage_stage" CHECK ("stage" IN ('research', 'validation', 'correction', 'final_validation')),
	CONSTRAINT "update_stage_in_order" CHECK ("stage" = (ARRAY['research', 'validation', 'correction', 'final_validation'])["position" + 1]),
	CONSTRAINT "update_stage_failure_format" CHECK ("failure" IS NULL OR "failure" ~ '^[a-z][a-z_]{0,63}$'),
	CONSTRAINT "update_stage_outcome" CHECK (("failure" IS NULL) = ("needs_correction" IS NOT NULL AND "proposal_valid" IS NOT NULL)),
	CONSTRAINT "update_stage_output_size" CHECK ("output" IS NULL OR octet_length("output"::text) <= 2000000),
	CONSTRAINT "update_stage_model_format" CHECK ("model" IS NULL OR "model" ~ '^[a-z0-9][a-z0-9.-]{0,63}$'),
	CONSTRAINT "update_stage_tokens" CHECK (coalesce("input_tokens", 0) >= 0 AND coalesce("output_tokens", 0) >= 0
        AND coalesce("cache_read_tokens", 0) >= 0 AND coalesce("cache_write_tokens", 0) >= 0
        AND coalesce("web_searches", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "knowledge"."update_stage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "update_request_route_requested_idx" ON "knowledge"."update_request" ("route_id","requested_at");--> statement-breakpoint
ALTER TABLE "knowledge"."update_end" ADD CONSTRAINT "update_end_request_id_update_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "knowledge"."update_request"("id");--> statement-breakpoint
ALTER TABLE "knowledge"."update_stage" ADD CONSTRAINT "update_stage_request_id_update_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "knowledge"."update_request"("id");--> statement-breakpoint
CREATE POLICY "rule_verdict_read" ON "knowledge"."rule_verdict" AS PERMISSIVE FOR SELECT TO "app_jobs" USING (true);--> statement-breakpoint
CREATE POLICY "rule_verdict_insert" ON "knowledge"."rule_verdict" AS PERMISSIVE FOR INSERT TO "app_jobs" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "update_end_read" ON "knowledge"."update_end" AS PERMISSIVE FOR SELECT TO "app_api", "app_jobs", "knowledge_definer" USING (true);--> statement-breakpoint
CREATE POLICY "update_end_insert" ON "knowledge"."update_end" AS PERMISSIVE FOR INSERT TO "app_jobs" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "update_request_read" ON "knowledge"."update_request" AS PERMISSIVE FOR SELECT TO "app_api", "app_jobs", "knowledge_definer" USING (true);--> statement-breakpoint
CREATE POLICY "update_request_insert_by_definer" ON "knowledge"."update_request" AS PERMISSIVE FOR INSERT TO "knowledge_definer" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "update_stage_read" ON "knowledge"."update_stage" AS PERMISSIVE FOR SELECT TO "app_api", "app_jobs" USING (true);--> statement-breakpoint
CREATE POLICY "update_stage_insert" ON "knowledge"."update_stage" AS PERMISSIVE FOR INSERT TO "app_jobs" WITH CHECK (true);