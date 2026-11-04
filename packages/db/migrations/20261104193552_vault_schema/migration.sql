CREATE SCHEMA "vault";
--> statement-breakpoint
CREATE TABLE "vault"."envelope" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"account_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"credential_id" text,
	"ciphertext" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "envelope_kind" CHECK ("kind" IN ('passkey_prf', 'recovery')),
	CONSTRAINT "envelope_credential_for_passkey" CHECK (("kind" = 'passkey_prf') = ("credential_id" IS NOT NULL)),
	CONSTRAINT "envelope_credential_format" CHECK ("credential_id" ~ '^[A-Za-z0-9_-]+$' AND char_length("credential_id") BETWEEN 16 AND 1366),
	CONSTRAINT "envelope_age_file" CHECK (octet_length("ciphertext") BETWEEN 64 AND 16384)
);
--> statement-breakpoint
ALTER TABLE "vault"."envelope" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vault"."recipient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"account_id" uuid NOT NULL,
	"recipient" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	CONSTRAINT "recipient_id_account_id_key" UNIQUE("id","account_id"),
	CONSTRAINT "recipient_hybrid" CHECK ("recipient" ~ '^age1pq1[02-9ac-hj-np-z]+$'),
	CONSTRAINT "recipient_length" CHECK (char_length("recipient") BETWEEN 8 AND 2100),
	CONSTRAINT "recipient_rotated_after_created" CHECK ("rotated_at" IS NULL OR "rotated_at" >= "created_at")
);
--> statement-breakpoint
ALTER TABLE "vault"."recipient" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vault"."sharing_state" (
	"account_id" uuid PRIMARY KEY,
	"version" integer NOT NULL,
	"state" bytea NOT NULL,
	"tag" bytea NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sharing_state_version" CHECK ("version" > 0),
	CONSTRAINT "sharing_state_tag_length" CHECK (octet_length("tag") = 32),
	CONSTRAINT "sharing_state_size" CHECK (octet_length("state") <= 1048576)
);
--> statement-breakpoint
ALTER TABLE "vault"."sharing_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "envelope_passkey_idx" ON "vault"."envelope" ("recipient_id","credential_id") WHERE "kind" = 'passkey_prf';--> statement-breakpoint
CREATE UNIQUE INDEX "envelope_recovery_idx" ON "vault"."envelope" ("recipient_id") WHERE "kind" = 'recovery';--> statement-breakpoint
CREATE INDEX "envelope_account_id_idx" ON "vault"."envelope" ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipient_current_idx" ON "vault"."recipient" ("account_id") WHERE "rotated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "vault"."envelope" ADD CONSTRAINT "envelope_recipient_fkey" FOREIGN KEY ("recipient_id","account_id") REFERENCES "vault"."recipient"("id","account_id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "envelope_select_own" ON "vault"."envelope" AS PERMISSIVE FOR SELECT TO "app_api" USING ("vault"."envelope"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "envelope_insert_own" ON "vault"."envelope" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK ("vault"."envelope"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "envelope_update_own" ON "vault"."envelope" AS PERMISSIVE FOR UPDATE TO "app_api" USING ("vault"."envelope"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK ("vault"."envelope"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "envelope_delete_own" ON "vault"."envelope" AS PERMISSIVE FOR DELETE TO "app_api" USING ("vault"."envelope"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "envelope_select_own_by_jobs" ON "vault"."envelope" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("vault"."envelope"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "envelope_delete_own_by_jobs" ON "vault"."envelope" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("vault"."envelope"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "recipient_select_own" ON "vault"."recipient" AS PERMISSIVE FOR SELECT TO "app_api" USING ("vault"."recipient"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "recipient_insert_own" ON "vault"."recipient" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK ("vault"."recipient"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "recipient_update_own" ON "vault"."recipient" AS PERMISSIVE FOR UPDATE TO "app_api" USING ("vault"."recipient"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK ("vault"."recipient"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "recipient_select_own_by_jobs" ON "vault"."recipient" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("vault"."recipient"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "recipient_delete_own_by_jobs" ON "vault"."recipient" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("vault"."recipient"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "sharing_state_select_own" ON "vault"."sharing_state" AS PERMISSIVE FOR SELECT TO "app_api" USING ("vault"."sharing_state"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "sharing_state_insert_own" ON "vault"."sharing_state" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK ("vault"."sharing_state"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "sharing_state_update_own" ON "vault"."sharing_state" AS PERMISSIVE FOR UPDATE TO "app_api" USING ("vault"."sharing_state"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK ("vault"."sharing_state"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "sharing_state_select_own_by_jobs" ON "vault"."sharing_state" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("vault"."sharing_state"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "sharing_state_delete_own_by_jobs" ON "vault"."sharing_state" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("vault"."sharing_state"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);