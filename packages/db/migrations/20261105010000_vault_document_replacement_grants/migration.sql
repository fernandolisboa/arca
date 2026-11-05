-- Document replacements and discarded objects (spec 0005, R4). app_api serves requests under
-- row-level security: an owner approves a replacement, confirms its upload, which changes the
-- document's object, size and SHA-256, and records each object it deletes while an upload grant
-- for it may still be live, which it reads back only for its own data export. app_jobs reads and deletes the account's rows under its identity, for
-- erasure and the daily cleanup. No other role reaches either table; the access tests check it.
ALTER TABLE "vault"."document_replacement" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "vault"."discarded_object" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, DELETE ON "vault"."document_replacement" TO app_api, app_jobs;
--> statement-breakpoint
GRANT INSERT ("document_id", "owner_id", "size", "sha256", "object_key", "recipients") ON "vault"."document_replacement" TO app_api;
--> statement-breakpoint
GRANT SELECT ON "vault"."discarded_object" TO app_api;
--> statement-breakpoint
GRANT INSERT ("object_key", "owner_id") ON "vault"."discarded_object" TO app_api;
--> statement-breakpoint
GRANT SELECT, DELETE ON "vault"."discarded_object" TO app_jobs;
--> statement-breakpoint
GRANT UPDATE ("object_key", "size", "sha256") ON "vault"."document" TO app_api;
