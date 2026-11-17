CREATE TABLE "knowledge"."ai_key" (
	"id" uuid PRIMARY KEY,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"ciphertext" bytea,
	"nonce" bytea,
	"tag" bytea,
	"kek_version" integer,
	"format_version" integer,
	"last_four" text,
	"removes_key_id" uuid CONSTRAINT "ai_key_removes_once" UNIQUE,
	"actor_account_id" uuid NOT NULL,
	"step_up_id" uuid NOT NULL CONSTRAINT "ai_key_step_up_id_key" UNIQUE,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "ai_key_id_provider_key" UNIQUE("id","provider"),
	CONSTRAINT "ai_key_provider" CHECK ("provider" IN ('anthropic', 'typesafe')),
	CONSTRAINT "ai_key_shape" CHECK (CASE "kind"
        WHEN 'set' THEN octet_length("ciphertext") BETWEEN 1 AND 1024
          AND octet_length("nonce") = 12 AND octet_length("tag") = 16
          AND "kek_version" > 0 AND "format_version" = 1
          AND char_length("last_four") = 4 AND "removes_key_id" IS NULL
        WHEN 'removed' THEN "ciphertext" IS NULL AND "nonce" IS NULL
          AND "tag" IS NULL AND "kek_version" IS NULL
          AND "format_version" IS NULL AND "last_four" IS NULL
          AND "removes_key_id" IS NOT NULL
        ELSE false END)
);
--> statement-breakpoint
ALTER TABLE "knowledge"."ai_key" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "knowledge"."ai_stage_setting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"stage" text NOT NULL,
	"model" text NOT NULL,
	"effort" text,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "ai_stage_setting_stage" CHECK ("stage" IN ('research', 'validation', 'correction')),
	CONSTRAINT "ai_stage_setting_model_format" CHECK ("model" ~ '^[a-z0-9][a-z0-9.-]{0,63}$'),
	CONSTRAINT "ai_stage_setting_effort" CHECK ("effort" IS NULL OR "effort" IN ('low', 'medium', 'high', 'xhigh', 'max'))
);
--> statement-breakpoint
ALTER TABLE "knowledge"."ai_stage_setting" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "ai_key_provider_at_idx" ON "knowledge"."ai_key" ("provider","at");--> statement-breakpoint
CREATE INDEX "ai_stage_setting_stage_at_idx" ON "knowledge"."ai_stage_setting" ("stage","at");--> statement-breakpoint
ALTER TABLE "knowledge"."ai_key" ADD CONSTRAINT "ai_key_removes_fkey" FOREIGN KEY ("removes_key_id","provider") REFERENCES "knowledge"."ai_key"("id","provider");--> statement-breakpoint
ALTER TABLE "auth"."step_up" DROP CONSTRAINT "step_up_purpose", ADD CONSTRAINT "step_up_purpose" CHECK ("purpose" IN ('sensitive_settings', 'account_deletion', 'data_export', 'financial_action', 'vault_unlock', 'vault_write', 'knowledge_decision', 'admin_grant', 'corrector_key', 'ai_key'));--> statement-breakpoint
ALTER TABLE "auth"."step_up_challenge" DROP CONSTRAINT "step_up_challenge_purpose", ADD CONSTRAINT "step_up_challenge_purpose" CHECK ("purpose" IN ('sensitive_settings', 'account_deletion', 'data_export', 'financial_action', 'vault_unlock', 'vault_write', 'knowledge_decision', 'admin_grant', 'corrector_key', 'ai_key'));--> statement-breakpoint
CREATE POLICY "ai_key_insert_with_step_up" ON "knowledge"."ai_key" AS PERMISSIVE FOR INSERT TO "app_auth" WITH CHECK ("knowledge"."ai_key"."actor_account_id" = nullif(current_setting('app.account_id', true), '')::uuid
        AND EXISTS (SELECT FROM "auth"."step_up"
          WHERE "auth"."step_up"."id" = "knowledge"."ai_key"."step_up_id"
            AND "auth"."step_up"."account_id" = "knowledge"."ai_key"."actor_account_id"
            AND "auth"."step_up"."purpose" = 'ai_key'
            AND "auth"."step_up"."consumed_at" IS NOT NULL));--> statement-breakpoint
CREATE POLICY "ai_key_read" ON "knowledge"."ai_key" AS PERMISSIVE FOR SELECT TO "app_api", "app_jobs" USING (true);--> statement-breakpoint
CREATE POLICY "ai_stage_setting_read" ON "knowledge"."ai_stage_setting" AS PERMISSIVE FOR SELECT TO "app_api", "app_jobs" USING (true);--> statement-breakpoint
CREATE POLICY "ai_stage_setting_insert_by_definer" ON "knowledge"."ai_stage_setting" AS PERMISSIVE FOR INSERT TO "knowledge_definer" WITH CHECK (true);