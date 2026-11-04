CREATE SCHEMA "account";
--> statement-breakpoint
CREATE TABLE "account"."link" (
	"inviter_id" uuid,
	"invitee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_pkey" PRIMARY KEY("inviter_id","invitee_id"),
	CONSTRAINT "link_two_accounts" CHECK ("inviter_id" <> "invitee_id")
);
--> statement-breakpoint
ALTER TABLE "account"."link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vault"."document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_id" uuid NOT NULL,
	"type_key" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" bytea NOT NULL,
	"object_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "document_id_owner_id_key" UNIQUE("id","owner_id"),
	CONSTRAINT "document_type_key" CHECK ("type_key" ~ '^[a-z][a-z0-9_.-]{0,63}$'),
	CONSTRAINT "document_size" CHECK ("size" BETWEEN 1 AND 26214400),
	CONSTRAINT "document_sha256_length" CHECK (octet_length("sha256") = 32),
	CONSTRAINT "document_object_key" CHECK ("object_key" ~ '^documents/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "document_confirmed_after_created" CHECK ("confirmed_at" IS NULL OR "confirmed_at" >= "created_at")
);
--> statement-breakpoint
ALTER TABLE "vault"."document" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vault"."document_recipient" (
	"document_id" uuid,
	"document_owner_id" uuid NOT NULL,
	"recipient_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_recipient_pkey" PRIMARY KEY("document_id","recipient_id"),
	CONSTRAINT "document_recipient_not_owner" CHECK ("recipient_id" <> "document_owner_id")
);
--> statement-breakpoint
ALTER TABLE "vault"."document_recipient" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "link_invitee_id_idx" ON "account"."link" ("invitee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_object_key_idx" ON "vault"."document" ("object_key");--> statement-breakpoint
CREATE INDEX "document_owner_id_idx" ON "vault"."document" ("owner_id");--> statement-breakpoint
CREATE INDEX "document_recipient_recipient_id_idx" ON "vault"."document_recipient" ("recipient_id");--> statement-breakpoint
CREATE INDEX "document_recipient_owner_id_idx" ON "vault"."document_recipient" ("document_owner_id");--> statement-breakpoint
ALTER TABLE "vault"."document_recipient" ADD CONSTRAINT "document_recipient_document_fkey" FOREIGN KEY ("document_id","document_owner_id") REFERENCES "vault"."document"("id","owner_id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "link_select_party" ON "account"."link" AS PERMISSIVE FOR SELECT TO "app_api" USING ("account"."link"."inviter_id" = nullif(current_setting('app.account_id', true), '')::uuid OR "account"."link"."invitee_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "link_insert_inviter" ON "account"."link" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK ("account"."link"."inviter_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "link_delete_party" ON "account"."link" AS PERMISSIVE FOR DELETE TO "app_api" USING ("account"."link"."inviter_id" = nullif(current_setting('app.account_id', true), '')::uuid OR "account"."link"."invitee_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "link_select_inviter_by_jobs" ON "account"."link" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("account"."link"."inviter_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "link_select_invitee_by_jobs" ON "account"."link" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("account"."link"."invitee_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "link_delete_inviter_by_jobs" ON "account"."link" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("account"."link"."inviter_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "link_delete_invitee_by_jobs" ON "account"."link" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("account"."link"."invitee_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_select_owner_or_recipient" ON "vault"."document" AS PERMISSIVE FOR SELECT TO "app_api" USING ("vault"."document"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid OR EXISTS (SELECT 1 FROM "vault"."document_recipient" r WHERE r.document_id = "vault"."document"."id" AND r.recipient_id = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "document_insert_own" ON "vault"."document" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK ("vault"."document"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_update_own" ON "vault"."document" AS PERMISSIVE FOR UPDATE TO "app_api" USING ("vault"."document"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK ("vault"."document"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_delete_own" ON "vault"."document" AS PERMISSIVE FOR DELETE TO "app_api" USING ("vault"."document"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_select_own_by_jobs" ON "vault"."document" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("vault"."document"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_delete_own_by_jobs" ON "vault"."document" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("vault"."document"."owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_recipient_select_party" ON "vault"."document_recipient" AS PERMISSIVE FOR SELECT TO "app_api" USING ("vault"."document_recipient"."document_owner_id" = nullif(current_setting('app.account_id', true), '')::uuid OR "vault"."document_recipient"."recipient_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_recipient_insert_owner" ON "vault"."document_recipient" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK ("vault"."document_recipient"."document_owner_id" = nullif(current_setting('app.account_id', true), '')::uuid AND EXISTS (SELECT 1 FROM "account"."link" WHERE ("account"."link"."inviter_id" = nullif(current_setting('app.account_id', true), '')::uuid AND "account"."link"."invitee_id" = "vault"."document_recipient"."recipient_id") OR ("account"."link"."invitee_id" = nullif(current_setting('app.account_id', true), '')::uuid AND "account"."link"."inviter_id" = "vault"."document_recipient"."recipient_id")));--> statement-breakpoint
CREATE POLICY "document_recipient_delete_owner" ON "vault"."document_recipient" AS PERMISSIVE FOR DELETE TO "app_api" USING ("vault"."document_recipient"."document_owner_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_recipient_select_own_by_jobs" ON "vault"."document_recipient" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("vault"."document_recipient"."recipient_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "document_recipient_delete_own_by_jobs" ON "vault"."document_recipient" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("vault"."document_recipient"."recipient_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "recipient_select_linked" ON "vault"."recipient" AS PERMISSIVE FOR SELECT TO "app_api" USING ("vault"."recipient"."rotated_at" IS NULL AND EXISTS (SELECT 1 FROM "account"."link" WHERE ("account"."link"."inviter_id" = nullif(current_setting('app.account_id', true), '')::uuid AND "account"."link"."invitee_id" = "vault"."recipient"."account_id") OR ("account"."link"."invitee_id" = nullif(current_setting('app.account_id', true), '')::uuid AND "account"."link"."inviter_id" = "vault"."recipient"."account_id")));