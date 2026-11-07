-- The admin role's history is insert-only (ADR-0027). app_auth inserts a grant or a removal in
-- the transaction that checks the role, every column but the time, which the database sets after
-- the lock; it reads the history for that check, and for the decisions that name a grant. app_api
-- reads the history, since every request reads the role. No role may update or delete; the access
-- tests check it.
ALTER TABLE "knowledge"."admin_grant" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT INSERT ("id", "kind", "grantee_account_id", "actor_account_id", "actor_basis", "actor_grant_id", "removes_grant_id", "step_up_id") ON "knowledge"."admin_grant" TO app_auth;
--> statement-breakpoint
GRANT SELECT ON "knowledge"."admin_grant" TO app_auth, app_api;
--> statement-breakpoint
-- A decision by a granted admin names the grant in force.
GRANT INSERT ("admin_grant_id") ON "knowledge"."decision" TO app_auth;
