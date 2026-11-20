ALTER TABLE "knowledge"."decision" ALTER COLUMN "approver_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ADD CONSTRAINT "decision_author" CHECK (("approver_account_id" IS NULL) = ("proof" = 'session_review'));--> statement-breakpoint
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
        WHEN 'admin_step_up' THEN CASE "admin_basis" WHEN 'owner_list' THEN "admin_grant_id" IS NULL
        WHEN 'grant' THEN "admin_grant_id" IS NOT NULL ELSE false END
          AND "credential_id" IS NOT NULL AND "public_key" IS NOT NULL
          AND "action_nonce" IS NOT NULL AND "server_nonce" IS NOT NULL
          AND "authenticator_data" IS NOT NULL AND "client_data_json" IS NOT NULL
          AND "signature" IS NOT NULL AND "step_up_id" IS NOT NULL
          AND ("cases_hash" IS NOT NULL) = ("subject_kind" = 'route')
        WHEN 'session_review' THEN "kind" = 'activate' AND "subject_kind" = 'route'
          AND "admin_basis" IS NULL AND "admin_grant_id" IS NULL
          AND "credential_id" IS NULL AND "public_key" IS NULL
          AND "action_nonce" IS NULL AND "server_nonce" IS NULL
          AND "authenticator_data" IS NULL AND "client_data_json" IS NULL
          AND "signature" IS NULL AND "step_up_id" IS NULL
          AND "cases_hash" IS NOT NULL
        ELSE false END);--> statement-breakpoint
ALTER TABLE "knowledge"."decision" DROP CONSTRAINT "decision_cases_hash", ADD CONSTRAINT "decision_cases_hash" CHECK ("cases_hash" IS NULL OR ("proof" IN ('admin_step_up', 'session_review') AND "cases_hash" ~ '^[0-9a-f]{64}$'));--> statement-breakpoint
CREATE POLICY "decision_insert_session_review" ON "knowledge"."decision" AS PERMISSIVE FOR INSERT TO "app_migrator" WITH CHECK ("knowledge"."decision"."proof" = 'session_review');