-- The independent check and the corrector run are gone (ADR-0031, #463). Their tables stay as
-- history: no runtime role reads or writes the check's starts, reports or progress, and no new
-- corrector key can be made or revoked. knowledge_definer keeps reading the keys, for the data
-- export. The corrector's definer functions stay, since only their owner could drop them; the API
-- no longer calls them.
REVOKE ALL ON "knowledge"."check_start" FROM app_api;
--> statement-breakpoint
REVOKE ALL ON "knowledge"."independent_check" FROM app_api, app_auth, app_jobs;
--> statement-breakpoint
REVOKE ALL ON "knowledge"."check_progress" FROM app_api, app_jobs;
--> statement-breakpoint
REVOKE INSERT ON "knowledge"."corrector_key" FROM app_auth;
--> statement-breakpoint
REVOKE INSERT ("id", "kind", "key_sha256", "actor_account_id", "step_up_id") ON "knowledge"."corrector_key" FROM app_auth;
--> statement-breakpoint
REVOKE INSERT ON "knowledge"."corrector_key" FROM knowledge_definer;
