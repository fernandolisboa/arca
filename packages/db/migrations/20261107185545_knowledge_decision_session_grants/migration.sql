-- app_auth now stores only `session` decisions (ADR-0027): it names the proof and why its author
-- was an admin, and may no longer write any step-up field, so it cannot store an ADR-0022 row.
-- The database sets decided_at, which app_auth was never granted. app_api already reads every
-- column of the table.
REVOKE INSERT ("credential_id", "public_key", "action_nonce", "server_nonce", "authenticator_data", "client_data_json", "signature", "step_up_id") ON "knowledge"."decision" FROM app_auth;
--> statement-breakpoint
GRANT INSERT ("proof", "admin_basis") ON "knowledge"."decision" TO app_auth;
