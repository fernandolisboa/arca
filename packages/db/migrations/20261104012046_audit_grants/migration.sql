-- The audit log is append-only (spec 0003, R7). app_audit inserts the caller-supplied columns only,
-- so the database sets id and time and no caller can backdate an event; app_api reads an account's
-- own events under row-level security. Neither may update or delete; the access tests check it.
ALTER TABLE "audit"."event" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "audit" TO app_audit, app_api;
--> statement-breakpoint
GRANT INSERT ("actor_account_id", "subject_account_id", "code", "request_id", "details") ON "audit"."event" TO app_audit;
--> statement-breakpoint
GRANT SELECT ON "audit"."event" TO app_api;
