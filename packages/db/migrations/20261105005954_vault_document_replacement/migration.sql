CREATE TABLE "vault"."discarded_object" (
	"object_key" text PRIMARY KEY,
	"owner_id" uuid NOT NULL,
	"discarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discarded_object_object_key" CHECK ("object_key" ~ '^documents/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);
--> statement-breakpoint
ALTER TABLE "vault"."discarded_object" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vault"."document_replacement" (
	"document_id" uuid PRIMARY KEY,
	"owner_id" uuid NOT NULL,
	"size" integer NOT NULL,
	"sha256" bytea NOT NULL,
	"object_key" text NOT NULL,
	"recipients" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_replacement_size" CHECK ("size" BETWEEN 1 AND 26214400),
	CONSTRAINT "document_replacement_sha256_length" CHECK (octet_length("sha256") = 32),
	CONSTRAINT "document_replacement_object_key" CHECK ("object_key" ~ '^documents/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "document_replacement_recipients" CHECK (cardinality("recipients") <= 16 AND NOT ("owner_id" = ANY ("recipients")))
);
--> statement-breakpoint
ALTER TABLE "vault"."document_replacement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "discarded_object_owner_id_idx" ON "vault"."discarded_object" ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_replacement_object_key_idx" ON "vault"."document_replacement" ("object_key");--> statement-breakpoint
CREATE INDEX "document_replacement_owner_id_idx" ON "vault"."document_replacement" ("owner_id");--> statement-breakpoint
ALTER TABLE "vault"."document_replacement" ADD CONSTRAINT "document_replacement_document_fkey" FOREIGN KEY ("document_id","owner_id") REFERENCES "vault"."document"("id","owner_id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "discarded_object_select_own" ON "vault"."discarded_object" AS PERMISSIVE FOR SELECT TO "app_api" USING ("vault"."discarded_object"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "discarded_object_insert_own" ON "vault"."discarded_object" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK ("vault"."discarded_object"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "discarded_object_select_own_by_jobs" ON "vault"."discarded_object" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("vault"."discarded_object"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "discarded_object_delete_own_by_jobs" ON "vault"."discarded_object" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("vault"."discarded_object"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_replacement_select_own" ON "vault"."document_replacement" AS PERMISSIVE FOR SELECT TO "app_api" USING ("vault"."document_replacement"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_replacement_insert_own" ON "vault"."document_replacement" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK ("vault"."document_replacement"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_replacement_delete_own" ON "vault"."document_replacement" AS PERMISSIVE FOR DELETE TO "app_api" USING ("vault"."document_replacement"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_replacement_select_own_by_jobs" ON "vault"."document_replacement" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("vault"."document_replacement"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_replacement_delete_own_by_jobs" ON "vault"."document_replacement" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("vault"."document_replacement"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);