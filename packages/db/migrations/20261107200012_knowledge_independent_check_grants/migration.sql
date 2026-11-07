-- The independent check (ADR-0027). app_api records starts under an environment-wide advisory
-- lock, every column but the ID and the time, which the database sets, and reads them back.
-- app_jobs inserts each start's report from the check's workflow step, every column but the ID and
-- the time, and reads reports; app_api and app_auth only read them. Nobody updates or deletes; the
-- access tests check it.
ALTER TABLE "knowledge"."check_start" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge"."independent_check" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "knowledge" TO app_jobs;
--> statement-breakpoint
GRANT SELECT ON "knowledge"."check_start" TO app_api;
--> statement-breakpoint
GRANT INSERT ("route_id", "version_number") ON "knowledge"."check_start" TO app_api;
--> statement-breakpoint
GRANT SELECT ON "knowledge"."independent_check" TO app_api, app_auth, app_jobs;
--> statement-breakpoint
GRANT INSERT ("start_id", "route_id", "version_number", "content_hash", "guide_hash", "prompt_version", "model", "items", "fetch_log", "failure", "failed", "clean") ON "knowledge"."independent_check" TO app_jobs;
