-- Rule rows are insert-only (ADR-0031). app_api and app_jobs read every row, since every
-- evaluation and every view reads the rules. Only app_migrator, which owns the tables, inserts,
-- through the reviewed import; it gives up updating, deleting and truncating its own rows, and with
-- no update or delete policy under forced row-level security nobody changes a row. The access tests
-- check it for every role.
ALTER TABLE "knowledge"."route_version" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge"."country_set" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge"."official_domain_list" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "knowledge"."route_version", "knowledge"."country_set", "knowledge"."official_domain_list" FROM app_migrator;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "knowledge" TO app_jobs;
--> statement-breakpoint
GRANT SELECT ON "knowledge"."route_version", "knowledge"."country_set", "knowledge"."official_domain_list" TO app_api, app_jobs;
