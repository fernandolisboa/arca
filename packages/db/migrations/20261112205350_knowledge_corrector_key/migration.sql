CREATE TABLE "knowledge"."corrector_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"kind" text NOT NULL,
	"key_sha256" bytea CONSTRAINT "corrector_key_sha256_key" UNIQUE,
	"revokes_key_id" uuid CONSTRAINT "corrector_key_revokes_once" UNIQUE,
	"actor_account_id" uuid NOT NULL,
	"step_up_id" uuid CONSTRAINT "corrector_key_step_up_id_key" UNIQUE,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "corrector_key_shape" CHECK (CASE "kind"
        WHEN 'created' THEN octet_length("key_sha256") = 32 AND "step_up_id" IS NOT NULL
          AND "revokes_key_id" IS NULL
        WHEN 'revoked' THEN "key_sha256" IS NULL AND "step_up_id" IS NULL
          AND "revokes_key_id" IS NOT NULL
        ELSE false END)
);
--> statement-breakpoint
ALTER TABLE "knowledge"."corrector_key" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge"."correction_event" ADD COLUMN "corrector_key_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge"."correction_event" ADD COLUMN "proposed_version" integer;--> statement-breakpoint
ALTER TABLE "knowledge"."correction_event" ADD COLUMN "explanation" text;--> statement-breakpoint
ALTER TABLE "knowledge"."correction_event" RENAME CONSTRAINT "correction_event_closed_once" TO "correction_event_once";--> statement-breakpoint
ALTER TABLE "knowledge"."correction_event" ADD CONSTRAINT "correction_event_corrector_key_fkey" FOREIGN KEY ("corrector_key_id") REFERENCES "knowledge"."corrector_key"("id");--> statement-breakpoint
ALTER TABLE "knowledge"."corrector_key" ADD CONSTRAINT "corrector_key_revokes_fkey" FOREIGN KEY ("revokes_key_id") REFERENCES "knowledge"."corrector_key"("id");--> statement-breakpoint
ALTER TABLE "knowledge"."correction_event" ADD CONSTRAINT "correction_event_shape" CHECK (CASE "kind"
        WHEN 'closed' THEN "corrector_key_id" IS NULL AND "proposed_version" IS NULL
          AND "explanation" IS NULL
        WHEN 'taken' THEN "corrector_key_id" IS NOT NULL AND "proposed_version" IS NULL
          AND "explanation" IS NULL
        WHEN 'answered' THEN "corrector_key_id" IS NOT NULL
          AND ("proposed_version" IS NULL) <> ("explanation" IS NULL)
          AND coalesce("proposed_version" > 0, true)
          AND coalesce(char_length("explanation") BETWEEN 1 AND 2000, true)
        ELSE false END);--> statement-breakpoint
ALTER TABLE "auth"."step_up" DROP CONSTRAINT "step_up_purpose", ADD CONSTRAINT "step_up_purpose" CHECK ("purpose" IN ('sensitive_settings', 'account_deletion', 'data_export', 'financial_action', 'vault_unlock', 'vault_write', 'knowledge_decision', 'admin_grant', 'corrector_key'));--> statement-breakpoint
ALTER TABLE "auth"."step_up_challenge" DROP CONSTRAINT "step_up_challenge_purpose", ADD CONSTRAINT "step_up_challenge_purpose" CHECK ("purpose" IN ('sensitive_settings', 'account_deletion', 'data_export', 'financial_action', 'vault_unlock', 'vault_write', 'knowledge_decision', 'admin_grant', 'corrector_key'));--> statement-breakpoint
ALTER TABLE "knowledge"."correction_event" DROP CONSTRAINT "correction_event_kind", ADD CONSTRAINT "correction_event_kind" CHECK ("kind" IN ('taken', 'answered', 'closed'));--> statement-breakpoint
CREATE POLICY "corrector_key_insert_by_owner" ON "knowledge"."corrector_key" AS PERMISSIVE FOR INSERT TO "app_auth" WITH CHECK ("knowledge"."corrector_key"."kind" = 'created' AND "knowledge"."corrector_key"."actor_account_id" = nullif(current_setting('app.account_id', true), '')::uuid
        AND EXISTS (SELECT FROM "auth"."step_up"
          WHERE "auth"."step_up"."id" = "knowledge"."corrector_key"."step_up_id"
            AND "auth"."step_up"."account_id" = "knowledge"."corrector_key"."actor_account_id"
            AND "auth"."step_up"."purpose" = 'corrector_key'
            AND "auth"."step_up"."consumed_at" IS NOT NULL));--> statement-breakpoint
CREATE POLICY "corrector_key_revoke_by_definer" ON "knowledge"."corrector_key" AS PERMISSIVE FOR INSERT TO "knowledge_definer" WITH CHECK ("knowledge"."corrector_key"."kind" = 'revoked');--> statement-breakpoint
CREATE POLICY "corrector_key_select_by_definer" ON "knowledge"."corrector_key" AS PERMISSIVE FOR SELECT TO "knowledge_definer" USING (true);