-- Document countries: app_api serves requests under row-level security, where only a document's
-- owner files it under a country, reads its countries back or takes one off. app_jobs reads and
-- deletes the account's rows under its identity, for erasure and the data export. No other role
-- reaches the table, and an account a document is shared with never reads its countries; the
-- access tests check both.
ALTER TABLE "vault"."document_country" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, DELETE ON "vault"."document_country" TO app_api, app_jobs;
--> statement-breakpoint
GRANT INSERT ("document_id", "owner_id", "country") ON "vault"."document_country" TO app_api;
