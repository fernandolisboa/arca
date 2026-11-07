CREATE TABLE "cases"."comparison_preferences" (
	"account_id" uuid PRIMARY KEY,
	"case_id" uuid NOT NULL,
	"preferences" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comparison_preferences_shape" CHECK (jsonb_typeof("preferences") = 'object' AND octet_length("preferences"::text) <= 65536)
);
--> statement-breakpoint
ALTER TABLE "cases"."comparison_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cases"."comparison_preferences" ADD CONSTRAINT "comparison_preferences_member_fkey" FOREIGN KEY ("case_id","account_id") REFERENCES "cases"."member"("case_id","account_id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "comparison_preferences_select_own" ON "cases"."comparison_preferences" AS PERMISSIVE FOR SELECT TO "app_api" USING ("cases"."comparison_preferences"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "comparison_preferences_insert_own" ON "cases"."comparison_preferences" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK ("cases"."comparison_preferences"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid AND cases.is_member("cases"."comparison_preferences"."case_id"));--> statement-breakpoint
CREATE POLICY "comparison_preferences_update_own" ON "cases"."comparison_preferences" AS PERMISSIVE FOR UPDATE TO "app_api" USING ("cases"."comparison_preferences"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK ("cases"."comparison_preferences"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "comparison_preferences_select_own_by_jobs" ON "cases"."comparison_preferences" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("cases"."comparison_preferences"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "comparison_preferences_delete_own_by_jobs" ON "cases"."comparison_preferences" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("cases"."comparison_preferences"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);