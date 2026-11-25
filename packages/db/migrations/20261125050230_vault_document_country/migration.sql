CREATE TABLE "vault"."document_country" (
	"document_id" uuid,
	"owner_id" uuid,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_country_pkey" PRIMARY KEY("document_id","owner_id","country"),
	CONSTRAINT "document_country_code" CHECK ("country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
ALTER TABLE "vault"."document_country" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "document_country_owner_id_idx" ON "vault"."document_country" ("owner_id");--> statement-breakpoint
ALTER TABLE "vault"."document_country" ADD CONSTRAINT "document_country_document_fkey" FOREIGN KEY ("document_id","owner_id") REFERENCES "vault"."document"("id","owner_id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "document_country_select_own" ON "vault"."document_country" AS PERMISSIVE FOR SELECT TO "app_api" USING ("vault"."document_country"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_country_insert_own" ON "vault"."document_country" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK ("vault"."document_country"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_country_delete_own" ON "vault"."document_country" AS PERMISSIVE FOR DELETE TO "app_api" USING ("vault"."document_country"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_country_select_own_by_jobs" ON "vault"."document_country" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("vault"."document_country"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_country_delete_own_by_jobs" ON "vault"."document_country" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("vault"."document_country"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);