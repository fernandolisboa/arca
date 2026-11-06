-- Rule summaries (ADR-0025) hold public rule content only. app_api reads them and inserts new ones;
-- nobody updates or deletes, so a later prompt or model adds a row instead of changing one. The
-- access tests check it.
ALTER TABLE "knowledge"."rule_summary" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "knowledge"."rule_summary" TO app_api;
