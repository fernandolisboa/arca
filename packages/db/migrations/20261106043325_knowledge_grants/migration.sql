-- Knowledge decisions are insert-only (spec 0007, R7): app_api inserts the caller-supplied columns,
-- so the database sets id and decided_at, and reads every decision, since every evaluation needs the
-- states. No role may update or delete; the access tests check it.
ALTER TABLE "knowledge"."decision" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "knowledge" TO app_api;
--> statement-breakpoint
GRANT INSERT ("kind", "route_id", "version_number", "content_hash", "approver_account_id", "credential_id", "public_key", "action_nonce", "server_nonce", "authenticator_data", "client_data_json", "signature", "step_up_id") ON "knowledge"."decision" TO app_api;
--> statement-breakpoint
GRANT SELECT ON "knowledge"."decision" TO app_api;
