-- Progress of the independent check (ADR-0027, "On demand, with progress"). app_jobs inserts each
-- event from the check's workflow step, every column but the time, which the database sets;
-- app_api reads them for the progress screen. Nobody updates or deletes; the access tests check it.
ALTER TABLE "knowledge"."check_progress" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON "knowledge"."check_progress" TO app_api;
--> statement-breakpoint
GRANT INSERT ("start_id", "sequence", "kind", "detail") ON "knowledge"."check_progress" TO app_jobs;
