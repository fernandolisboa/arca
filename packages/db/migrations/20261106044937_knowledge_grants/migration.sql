-- Knowledge decisions are insert-only (spec 0007, R7). app_auth inserts a decision in the
-- transaction that spends its step-up, every column but decided_at, which the database sets, and
-- its policy admits only a row that copies a spent knowledge_decision step-up of the approver; it
-- reads nothing back. app_api reads every decision, since every evaluation needs the states. No
-- role may update or delete; the access tests check it.
ALTER TABLE "knowledge"."decision" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "knowledge" TO app_auth, app_api;
--> statement-breakpoint
GRANT INSERT ("id", "kind", "route_id", "version_number", "content_hash", "approver_account_id", "credential_id", "public_key", "action_nonce", "server_nonce", "authenticator_data", "client_data_json", "signature", "step_up_id") ON "knowledge"."decision" TO app_auth;
--> statement-breakpoint
GRANT SELECT ON "knowledge"."decision" TO app_api;
