-- The vault (spec 0005, R2). app_api serves the account's own rows under row-level security:
-- recipients are added and marked rotated, never changed otherwise; envelopes are added, re-sealed
-- (ciphertext only) and deleted; the sharing state is written whole. app_jobs reads and deletes
-- the account's rows under its identity, for erasure and the daily cleanup. No other role reaches
-- the schema; the access tests check it.
ALTER TABLE "vault"."recipient" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "vault"."envelope" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "vault"."sharing_state" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "vault" TO app_api, app_jobs;
--> statement-breakpoint
GRANT SELECT ON "vault"."recipient", "vault"."envelope", "vault"."sharing_state" TO app_api, app_jobs;
--> statement-breakpoint
GRANT DELETE ON "vault"."recipient", "vault"."envelope", "vault"."sharing_state" TO app_jobs;
--> statement-breakpoint
GRANT INSERT ("account_id", "recipient") ON "vault"."recipient" TO app_api;
--> statement-breakpoint
GRANT UPDATE ("rotated_at") ON "vault"."recipient" TO app_api;
--> statement-breakpoint
GRANT INSERT ("account_id", "recipient_id", "kind", "credential_id", "ciphertext") ON "vault"."envelope" TO app_api;
--> statement-breakpoint
GRANT UPDATE ("ciphertext") ON "vault"."envelope" TO app_api;
--> statement-breakpoint
GRANT DELETE ON "vault"."envelope" TO app_api;
--> statement-breakpoint
GRANT INSERT ("account_id", "version", "state", "tag") ON "vault"."sharing_state" TO app_api;
--> statement-breakpoint
GRANT UPDATE ("version", "state", "tag", "updated_at") ON "vault"."sharing_state" TO app_api;
