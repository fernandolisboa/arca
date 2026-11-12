-- app_auth inserts a created key's columns but never its time, which the database sets: a row
-- dated in the future would stay the newest key and never reach its year.
REVOKE INSERT ON "knowledge"."corrector_key" FROM app_auth;
--> statement-breakpoint
GRANT INSERT ("id", "kind", "key_sha256", "actor_account_id", "step_up_id") ON "knowledge"."corrector_key" TO app_auth;
