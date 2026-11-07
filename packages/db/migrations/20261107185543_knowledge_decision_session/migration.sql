DROP POLICY "decision_insert_spent_step_up" ON "knowledge"."decision";--> statement-breakpoint
-- Every decision stored before ADR-0027 copies a step-up (ADR-0022). The default only fills those
-- rows: it is dropped at once, so every new decision names its proof.
ALTER TABLE "knowledge"."decision" ADD COLUMN "proof" text DEFAULT 'step_up' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ALTER COLUMN "proof" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ADD COLUMN "admin_basis" text;--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ALTER COLUMN "credential_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ALTER COLUMN "public_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ALTER COLUMN "action_nonce" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ALTER COLUMN "server_nonce" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ALTER COLUMN "authenticator_data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ALTER COLUMN "client_data_json" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ALTER COLUMN "signature" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ALTER COLUMN "step_up_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ALTER COLUMN "decided_at" SET DEFAULT clock_timestamp();--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ADD CONSTRAINT "decision_proof" CHECK (CASE "proof"
        WHEN 'step_up' THEN "admin_basis" IS NULL
          AND "credential_id" IS NOT NULL AND "public_key" IS NOT NULL
          AND "action_nonce" IS NOT NULL AND "server_nonce" IS NOT NULL
          AND "authenticator_data" IS NOT NULL AND "client_data_json" IS NOT NULL
          AND "signature" IS NOT NULL AND "step_up_id" IS NOT NULL
        WHEN 'session' THEN "admin_basis" IS NOT DISTINCT FROM 'owner_list'
          AND "credential_id" IS NULL AND "public_key" IS NULL
          AND "action_nonce" IS NULL AND "server_nonce" IS NULL
          AND "authenticator_data" IS NULL AND "client_data_json" IS NULL
          AND "signature" IS NULL AND "step_up_id" IS NULL
        ELSE false END);--> statement-breakpoint
CREATE POLICY "decision_insert_session" ON "knowledge"."decision" AS PERMISSIVE FOR INSERT TO "app_auth" WITH CHECK ("knowledge"."decision"."proof" = 'session'
        AND "knowledge"."decision"."approver_account_id" = nullif(current_setting('app.account_id', true), '')::uuid);