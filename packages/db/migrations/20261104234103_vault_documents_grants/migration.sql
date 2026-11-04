-- Documents and account links (spec 0005, R4). app_api serves requests under row-level security:
-- an owner adds documents, confirms their uploads, deletes them and shares them with a linked
-- account; a recipient reads only what is shared with it; an invite's inviter adds the link and
-- either party reads or removes it. app_jobs reads and deletes the account's rows under its
-- identity, for erasure and the daily cleanup. No other role reaches either schema; the access
-- tests check it.
ALTER TABLE "account"."link" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "vault"."document" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "vault"."document_recipient" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "account" TO app_api, app_jobs;
--> statement-breakpoint
GRANT SELECT, DELETE ON "account"."link" TO app_api, app_jobs;
--> statement-breakpoint
GRANT INSERT ("inviter_id", "invitee_id") ON "account"."link" TO app_api;
--> statement-breakpoint
GRANT SELECT, DELETE ON "vault"."document", "vault"."document_recipient" TO app_api, app_jobs;
--> statement-breakpoint
GRANT INSERT ("owner_id", "type_key", "size", "sha256", "object_key") ON "vault"."document" TO app_api;
--> statement-breakpoint
GRANT UPDATE ("confirmed_at") ON "vault"."document" TO app_api;
--> statement-breakpoint
GRANT INSERT ("document_id", "document_owner_id", "recipient_id") ON "vault"."document_recipient" TO app_api;
