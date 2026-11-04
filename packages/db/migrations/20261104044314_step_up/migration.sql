CREATE TABLE "auth"."step_up" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"purpose" text NOT NULL,
	"subject_hash" bytea NOT NULL,
	"nonce" bytea NOT NULL,
	"authenticator_data" bytea NOT NULL,
	"client_data_json" bytea NOT NULL,
	"signature" bytea NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "step_up_purpose" CHECK ("purpose" IN ('sensitive_settings', 'account_deletion', 'data_export', 'financial_action', 'vault_unlock', 'vault_write')),
	CONSTRAINT "step_up_subject" CHECK (("purpose" = 'vault_unlock') = (octet_length("subject_hash") = 0) AND octet_length("subject_hash") IN (0, 32)),
	CONSTRAINT "step_up_nonce_length" CHECK (octet_length("nonce") = 32)
);
--> statement-breakpoint
CREATE TABLE "auth"."step_up_challenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"subject_hash" bytea NOT NULL,
	"nonce" bytea NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '2 minutes' NOT NULL,
	CONSTRAINT "step_up_challenge_purpose" CHECK ("purpose" IN ('sensitive_settings', 'account_deletion', 'data_export', 'financial_action', 'vault_unlock', 'vault_write')),
	CONSTRAINT "step_up_challenge_subject" CHECK (("purpose" = 'vault_unlock') = (octet_length("subject_hash") = 0) AND octet_length("subject_hash") IN (0, 32)),
	CONSTRAINT "step_up_challenge_nonce_length" CHECK (octet_length("nonce") = 32)
);
--> statement-breakpoint
CREATE INDEX "step_up_session_purpose_idx" ON "auth"."step_up" ("session_id","purpose","verified_at");--> statement-breakpoint
CREATE INDEX "step_up_account_id_idx" ON "auth"."step_up" ("account_id");--> statement-breakpoint
CREATE INDEX "step_up_unspent_idx" ON "auth"."step_up" ("verified_at") WHERE "consumed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "step_up_challenge_expires_at_idx" ON "auth"."step_up_challenge" ("expires_at");--> statement-breakpoint
ALTER TABLE "auth"."step_up" ADD CONSTRAINT "step_up_account_id_user_id_fkey" FOREIGN KEY ("account_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."step_up_challenge" ADD CONSTRAINT "step_up_challenge_account_id_user_id_fkey" FOREIGN KEY ("account_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."step_up_challenge" ADD CONSTRAINT "step_up_challenge_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth"."session"("id") ON DELETE CASCADE;