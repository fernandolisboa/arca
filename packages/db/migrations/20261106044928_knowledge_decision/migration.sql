CREATE SCHEMA "knowledge";
--> statement-breakpoint
CREATE TABLE "knowledge"."decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"kind" text NOT NULL,
	"route_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"content_hash" text NOT NULL,
	"approver_account_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" bytea NOT NULL,
	"action_nonce" bytea NOT NULL,
	"server_nonce" bytea NOT NULL,
	"authenticator_data" bytea NOT NULL,
	"client_data_json" bytea NOT NULL,
	"signature" bytea NOT NULL,
	"step_up_id" uuid NOT NULL CONSTRAINT "decision_step_up_id_key" UNIQUE,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_kind" CHECK ("kind" IN ('activate', 'reject')),
	CONSTRAINT "decision_route_id_format" CHECK ("route_id" ~ '^[a-z]{2}-[a-z0-9][a-z0-9-]{0,62}$'),
	CONSTRAINT "decision_version_number_positive" CHECK ("version_number" > 0),
	CONSTRAINT "decision_content_hash_format" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "decision_action_nonce_length" CHECK (octet_length("action_nonce") = 16),
	CONSTRAINT "decision_server_nonce_length" CHECK (octet_length("server_nonce") = 32)
);
--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth"."step_up" DROP CONSTRAINT "step_up_purpose", ADD CONSTRAINT "step_up_purpose" CHECK ("purpose" IN ('sensitive_settings', 'account_deletion', 'data_export', 'financial_action', 'vault_unlock', 'vault_write', 'knowledge_decision'));--> statement-breakpoint
ALTER TABLE "auth"."step_up_challenge" DROP CONSTRAINT "step_up_challenge_purpose", ADD CONSTRAINT "step_up_challenge_purpose" CHECK ("purpose" IN ('sensitive_settings', 'account_deletion', 'data_export', 'financial_action', 'vault_unlock', 'vault_write', 'knowledge_decision'));--> statement-breakpoint
CREATE POLICY "decision_insert_spent_step_up" ON "knowledge"."decision" AS PERMISSIVE FOR INSERT TO "app_auth" WITH CHECK (EXISTS (SELECT FROM "auth"."step_up"
        WHERE "auth"."step_up"."id" = "knowledge"."decision"."step_up_id"
          AND "auth"."step_up"."account_id" = "knowledge"."decision"."approver_account_id"
          AND "auth"."step_up"."purpose" = 'knowledge_decision'
          AND "auth"."step_up"."consumed_at" IS NOT NULL
          AND "auth"."step_up"."credential_id" = "knowledge"."decision"."credential_id"
          AND "auth"."step_up"."nonce" = "knowledge"."decision"."server_nonce"
          AND "auth"."step_up"."authenticator_data" = "knowledge"."decision"."authenticator_data"
          AND "auth"."step_up"."client_data_json" = "knowledge"."decision"."client_data_json"
          AND "auth"."step_up"."signature" = "knowledge"."decision"."signature"));--> statement-breakpoint
CREATE POLICY "decision_read" ON "knowledge"."decision" AS PERMISSIVE FOR SELECT TO "app_api" USING (true);