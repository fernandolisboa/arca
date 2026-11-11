CREATE TABLE "knowledge"."check_progress" (
	"start_id" uuid,
	"sequence" integer,
	"kind" text NOT NULL,
	"detail" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "check_progress_pkey" PRIMARY KEY("start_id","sequence"),
	CONSTRAINT "check_progress_sequence_range" CHECK ("sequence" BETWEEN 0 AND 999),
	CONSTRAINT "check_progress_kind_format" CHECK ("kind" ~ '^[a-z][a-z_]{0,19}$'),
	CONSTRAINT "check_progress_detail_object" CHECK (jsonb_typeof("detail") = 'object' AND length("detail"::text) <= 2500)
);
--> statement-breakpoint
ALTER TABLE "knowledge"."check_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "check_progress_read" ON "knowledge"."check_progress" AS PERMISSIVE FOR SELECT TO "app_api" USING (true);--> statement-breakpoint
CREATE POLICY "check_progress_insert" ON "knowledge"."check_progress" AS PERMISSIVE FOR INSERT TO "app_jobs" WITH CHECK (true);