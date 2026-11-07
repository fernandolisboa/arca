CREATE TABLE "knowledge"."admin_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"kind" text NOT NULL,
	"grantee_account_id" uuid NOT NULL,
	"actor_account_id" uuid NOT NULL,
	"actor_basis" text NOT NULL,
	"actor_grant_id" uuid,
	"removes_grant_id" uuid,
	"step_up_id" uuid CONSTRAINT "admin_grant_step_up_id_key" UNIQUE,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "admin_grant_kind" CHECK ("kind" IN ('grant', 'removal')),
	CONSTRAINT "admin_grant_actor_basis" CHECK (CASE "actor_basis" WHEN 'owner_list' THEN "actor_grant_id" IS NULL
        WHEN 'grant' THEN "actor_grant_id" IS NOT NULL ELSE false END),
	CONSTRAINT "admin_grant_shape" CHECK (CASE "kind"
        WHEN 'grant' THEN "step_up_id" IS NOT NULL AND "removes_grant_id" IS NULL
          AND "grantee_account_id" <> "actor_account_id"
        WHEN 'removal' THEN "step_up_id" IS NULL AND "removes_grant_id" IS NOT NULL
        ELSE false END)
);
--> statement-breakpoint
ALTER TABLE "knowledge"."admin_grant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ADD COLUMN "admin_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "auth"."step_up" DROP CONSTRAINT "step_up_purpose", ADD CONSTRAINT "step_up_purpose" CHECK ("purpose" IN ('sensitive_settings', 'account_deletion', 'data_export', 'financial_action', 'vault_unlock', 'vault_write', 'knowledge_decision', 'admin_grant'));--> statement-breakpoint
ALTER TABLE "auth"."step_up_challenge" DROP CONSTRAINT "step_up_challenge_purpose", ADD CONSTRAINT "step_up_challenge_purpose" CHECK ("purpose" IN ('sensitive_settings', 'account_deletion', 'data_export', 'financial_action', 'vault_unlock', 'vault_write', 'knowledge_decision', 'admin_grant'));--> statement-breakpoint
ALTER TABLE "knowledge"."decision" DROP CONSTRAINT "decision_proof", ADD CONSTRAINT "decision_proof" CHECK (CASE "proof"
        WHEN 'step_up' THEN "admin_basis" IS NULL AND "admin_grant_id" IS NULL
          AND "credential_id" IS NOT NULL AND "public_key" IS NOT NULL
          AND "action_nonce" IS NOT NULL AND "server_nonce" IS NOT NULL
          AND "authenticator_data" IS NOT NULL AND "client_data_json" IS NOT NULL
          AND "signature" IS NOT NULL AND "step_up_id" IS NOT NULL
        WHEN 'session' THEN CASE "admin_basis" WHEN 'owner_list' THEN "admin_grant_id" IS NULL
        WHEN 'grant' THEN "admin_grant_id" IS NOT NULL ELSE false END
          AND "credential_id" IS NULL AND "public_key" IS NULL
          AND "action_nonce" IS NULL AND "server_nonce" IS NULL
          AND "authenticator_data" IS NULL AND "client_data_json" IS NULL
          AND "signature" IS NULL AND "step_up_id" IS NULL
        ELSE false END);--> statement-breakpoint
CREATE POLICY "admin_grant_insert_by_admin" ON "knowledge"."admin_grant" AS PERMISSIVE FOR INSERT TO "app_auth" WITH CHECK ("knowledge"."admin_grant"."actor_account_id" = nullif(current_setting('app.account_id', true), '')::uuid
        AND ("knowledge"."admin_grant"."actor_basis" = 'owner_list' OR EXISTS (SELECT FROM "knowledge"."admin_grant" "given"
        WHERE "given"."id" = "knowledge"."admin_grant"."actor_grant_id" AND "given"."kind" = 'grant'
          AND "given"."grantee_account_id" = "knowledge"."admin_grant"."actor_account_id"))
        AND CASE "knowledge"."admin_grant"."kind"
          WHEN 'grant' THEN EXISTS (SELECT FROM "auth"."step_up"
            WHERE "auth"."step_up"."id" = "knowledge"."admin_grant"."step_up_id"
              AND "auth"."step_up"."account_id" = "knowledge"."admin_grant"."actor_account_id"
              AND "auth"."step_up"."purpose" = 'admin_grant'
              AND "auth"."step_up"."consumed_at" IS NOT NULL)
          WHEN 'removal' THEN EXISTS (SELECT FROM "knowledge"."admin_grant" "given"
        WHERE "given"."id" = "knowledge"."admin_grant"."removes_grant_id" AND "given"."kind" = 'grant'
          AND "given"."grantee_account_id" = "knowledge"."admin_grant"."grantee_account_id")
          ELSE false END);--> statement-breakpoint
CREATE POLICY "admin_grant_read_auth" ON "knowledge"."admin_grant" AS PERMISSIVE FOR SELECT TO "app_auth" USING (true);--> statement-breakpoint
CREATE POLICY "admin_grant_read_api" ON "knowledge"."admin_grant" AS PERMISSIVE FOR SELECT TO "app_api" USING (true);--> statement-breakpoint
ALTER POLICY "decision_insert_session" ON "knowledge"."decision" TO "app_auth" WITH CHECK ("knowledge"."decision"."proof" = 'session' AND "knowledge"."decision"."approver_account_id" = nullif(current_setting('app.account_id', true), '')::uuid
        AND ("knowledge"."decision"."admin_basis" = 'owner_list'
          OR EXISTS (SELECT FROM "knowledge"."admin_grant" "given"
        WHERE "given"."id" = "knowledge"."decision"."admin_grant_id" AND "given"."kind" = 'grant'
          AND "given"."grantee_account_id" = "knowledge"."decision"."approver_account_id")));