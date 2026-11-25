-- Checklist marks (spec #519): app_api serves requests under row-level security, where only the
-- keeper of a mark's person writes it, and reads it with the members the keeper shared the
-- person's checklist with. A link names only the keeper's own vault document. app_jobs erases the
-- marks with their person, through the cascade, so it needs no grant here. No other role reaches
-- the table; the access tests check it.
ALTER TABLE "cases"."checklist_mark" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, DELETE ON "cases"."checklist_mark" TO app_api;
--> statement-breakpoint
GRANT INSERT ("case_id", "person_id", "route_id", "document_id", "state", "vault_document_id", "vault_owner_id") ON "cases"."checklist_mark" TO app_api;
--> statement-breakpoint
GRANT UPDATE ("state", "vault_document_id", "vault_owner_id", "updated_at") ON "cases"."checklist_mark" TO app_api;
