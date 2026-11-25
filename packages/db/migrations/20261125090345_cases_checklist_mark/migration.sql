CREATE TABLE "cases"."checklist_mark" (
	"case_id" uuid NOT NULL,
	"person_id" uuid,
	"route_id" text,
	"document_id" text,
	"state" text NOT NULL,
	"vault_document_id" uuid,
	"vault_owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_mark_pkey" PRIMARY KEY("person_id","route_id","document_id"),
	CONSTRAINT "checklist_mark_state" CHECK ("state" IN ('had', 'missing')),
	CONSTRAINT "checklist_mark_route_id_format" CHECK ("route_id" ~ '^[a-z]{2}-[a-z0-9][a-z0-9-]{0,62}$'),
	CONSTRAINT "checklist_mark_document_id_format" CHECK ("document_id" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
	CONSTRAINT "checklist_mark_link" CHECK (("vault_document_id" IS NULL) = ("vault_owner_id" IS NULL) AND ("vault_document_id" IS NULL OR "state" = 'had'))
);
--> statement-breakpoint
ALTER TABLE "cases"."checklist_mark" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "checklist_mark_vault_document_id_idx" ON "cases"."checklist_mark" ("vault_document_id");--> statement-breakpoint
CREATE INDEX "checklist_mark_case_route_idx" ON "cases"."checklist_mark" ("case_id","route_id");--> statement-breakpoint
ALTER TABLE "cases"."checklist_mark" ADD CONSTRAINT "checklist_mark_person_fkey" FOREIGN KEY ("person_id","case_id") REFERENCES "cases"."person"("id","case_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cases"."checklist_mark" ADD CONSTRAINT "checklist_mark_vault_document_fkey" FOREIGN KEY ("vault_document_id","vault_owner_id") REFERENCES "vault"."document"("id","owner_id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "cases"."share" DROP CONSTRAINT "share_scope", ADD CONSTRAINT "share_scope" CHECK ("scope" IN ('profile', 'finances', 'checklist'));--> statement-breakpoint
CREATE POLICY "checklist_mark_select_keeper_or_shared" ON "cases"."checklist_mark" AS PERMISSIVE FOR SELECT TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."checklist_mark"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid) OR EXISTS (SELECT 1 FROM "cases"."share" WHERE "cases"."share"."person_id" = "cases"."checklist_mark"."person_id" AND "cases"."share"."grantee_account_id" = nullif(current_setting('app.account_id', true), '')::uuid AND "cases"."share"."scope" = 'checklist'));--> statement-breakpoint
CREATE POLICY "checklist_mark_insert_keeper" ON "cases"."checklist_mark" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."checklist_mark"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid) AND ("cases"."checklist_mark"."vault_owner_id" IS NULL OR "cases"."checklist_mark"."vault_owner_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "checklist_mark_update_keeper" ON "cases"."checklist_mark" AS PERMISSIVE FOR UPDATE TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."checklist_mark"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid)) WITH CHECK (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."checklist_mark"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid) AND ("cases"."checklist_mark"."vault_owner_id" IS NULL OR "cases"."checklist_mark"."vault_owner_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "checklist_mark_delete_keeper" ON "cases"."checklist_mark" AS PERMISSIVE FOR DELETE TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."checklist_mark"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));