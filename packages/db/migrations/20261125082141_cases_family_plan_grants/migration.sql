-- The family plan (ADR-0040). app_api reads, adds and deletes its rows under row-level security,
-- where every member of the case does all three and nobody else does any; a write replaces the
-- whole plan, so no role updates a row. The rows go with their people through the foreign keys'
-- cascades, so app_jobs needs no access of its own. No other role reaches the tables.
ALTER TABLE "cases"."plan_move" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cases"."plan_move_dependent" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, DELETE ON "cases"."plan_move", "cases"."plan_move_dependent" TO app_api;
--> statement-breakpoint
GRANT INSERT ("case_id", "position", "stage", "route_id", "principal_id") ON "cases"."plan_move" TO app_api;
--> statement-breakpoint
GRANT INSERT ("move_id", "case_id", "person_id") ON "cases"."plan_move_dependent" TO app_api;
