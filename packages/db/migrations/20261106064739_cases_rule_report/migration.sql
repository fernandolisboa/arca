CREATE TABLE "cases"."rule_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"case_id" uuid NOT NULL,
	"reporter_account_id" uuid NOT NULL,
	"route_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"requirement_id" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"state" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "rule_report_reason" CHECK ("reason" IN ('outdated', 'wrong_amount', 'wrong_condition', 'source_mismatch', 'other')),
	CONSTRAINT "rule_report_state" CHECK ("state" IN ('open', 'closed')),
	CONSTRAINT "rule_report_closed_at" CHECK (("state" = 'closed') = ("closed_at" IS NOT NULL)),
	CONSTRAINT "rule_report_note_length" CHECK (char_length("note") BETWEEN 1 AND 500),
	CONSTRAINT "rule_report_route_id_format" CHECK ("route_id" ~ '^[a-z]{2}-[a-z0-9][a-z0-9-]{0,62}$'),
	CONSTRAINT "rule_report_version_number_positive" CHECK ("version_number" > 0),
	CONSTRAINT "rule_report_requirement_id_format" CHECK ("requirement_id" ~ '^[a-z0-9][a-z0-9-]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE "cases"."rule_report" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "rule_report_reporter_account_id_idx" ON "cases"."rule_report" ("reporter_account_id");--> statement-breakpoint
CREATE INDEX "rule_report_open_idx" ON "cases"."rule_report" ("route_id","version_number","requirement_id") WHERE "state" = 'open';--> statement-breakpoint
ALTER TABLE "cases"."rule_report" ADD CONSTRAINT "rule_report_reporter_fkey" FOREIGN KEY ("case_id","reporter_account_id") REFERENCES "cases"."member"("case_id","account_id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "rule_report_select_reporter" ON "cases"."rule_report" AS PERMISSIVE FOR SELECT TO "app_api" USING ("cases"."rule_report"."reporter_account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "rule_report_insert_reporter" ON "cases"."rule_report" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK ("cases"."rule_report"."reporter_account_id" = nullif(current_setting('app.account_id', true), '')::uuid AND cases.is_member("cases"."rule_report"."case_id"));--> statement-breakpoint
CREATE POLICY "rule_report_select_own_by_jobs" ON "cases"."rule_report" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("cases"."rule_report"."reporter_account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "rule_report_delete_own_by_jobs" ON "cases"."rule_report" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("cases"."rule_report"."reporter_account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "rule_report_select_by_definer" ON "cases"."rule_report" AS PERMISSIVE FOR SELECT TO "cases_definer" USING (true);--> statement-breakpoint
CREATE POLICY "rule_report_update_by_definer" ON "cases"."rule_report" AS PERMISSIVE FOR UPDATE TO "cases_definer" USING (true) WITH CHECK (true);