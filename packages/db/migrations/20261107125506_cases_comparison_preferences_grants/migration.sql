-- A member's comparison preferences (ADR-0026). app_api reads and writes only the identity's own
-- row; app_jobs erases it under the member's identity. No other role sees it.
ALTER TABLE "cases"."comparison_preferences" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON "cases"."comparison_preferences" TO app_api;
--> statement-breakpoint
GRANT INSERT ("account_id", "case_id", "preferences") ON "cases"."comparison_preferences" TO app_api;
--> statement-breakpoint
GRANT UPDATE ("preferences", "updated_at") ON "cases"."comparison_preferences" TO app_api;
--> statement-breakpoint
GRANT SELECT, DELETE ON "cases"."comparison_preferences" TO app_jobs;
