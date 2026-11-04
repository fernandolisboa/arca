CREATE TABLE "auth"."passkey_activation" (
	"credential_id" text PRIMARY KEY,
	"active_from" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."passkey_challenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"challenge" bytea NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '2 minutes' NOT NULL,
	CONSTRAINT "passkey_challenge_length" CHECK (octet_length("challenge") = 32)
);
--> statement-breakpoint
CREATE INDEX "passkey_activation_active_from_idx" ON "auth"."passkey_activation" ("active_from");--> statement-breakpoint
CREATE INDEX "passkey_challenge_expires_at_idx" ON "auth"."passkey_challenge" ("expires_at");--> statement-breakpoint
ALTER TABLE "auth"."passkey_activation" ADD CONSTRAINT "passkey_activation_credential_id_passkey_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "auth"."passkey"("credential_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."passkey_challenge" ADD CONSTRAINT "passkey_challenge_account_id_user_id_fkey" FOREIGN KEY ("account_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."passkey_challenge" ADD CONSTRAINT "passkey_challenge_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth"."session"("id") ON DELETE CASCADE;