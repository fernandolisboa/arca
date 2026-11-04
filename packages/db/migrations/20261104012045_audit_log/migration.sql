CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE TABLE "audit"."event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"time" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_account_id" uuid,
	"subject_account_id" uuid NOT NULL,
	"code" text NOT NULL,
	"request_id" text,
	"details" jsonb DEFAULT '{}' NOT NULL,
	CONSTRAINT "event_code_format" CHECK ("code" ~ '^[a-z_]{1,64}$'),
	CONSTRAINT "event_details_object" CHECK (jsonb_typeof("details") = 'object')
);
--> statement-breakpoint
ALTER TABLE "audit"."event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "event_subject_time_idx" ON "audit"."event" ("subject_account_id","time" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "event_insert_by_audit" ON "audit"."event" AS PERMISSIVE FOR INSERT TO "app_audit" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "event_read_own" ON "audit"."event" AS PERMISSIVE FOR SELECT TO "app_api" USING ("audit"."event"."subject_account_id" = nullif(current_setting('app.account_id', true), '')::uuid);