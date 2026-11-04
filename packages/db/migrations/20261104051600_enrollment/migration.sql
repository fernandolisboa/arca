CREATE TABLE "auth"."passkey_capability" (
	"credential_id" text PRIMARY KEY,
	"prf_enabled" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."recovery_code" (
	"account_id" uuid PRIMARY KEY,
	"salt" bytea NOT NULL,
	"code_hash" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "recovery_code_salt_length" CHECK (octet_length("salt") = 16),
	CONSTRAINT "recovery_code_hash_length" CHECK (octet_length("code_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "auth"."registration_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"token_hash" bytea NOT NULL UNIQUE,
	"kind" text NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '30 minutes' NOT NULL,
	CONSTRAINT "registration_context_kind" CHECK ("kind" IN ('owner')),
	CONSTRAINT "registration_context_token_length" CHECK (octet_length("token_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "auth"."setup" (
	"code_hash" bytea PRIMARY KEY,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."user" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "registration_context_expires_at_idx" ON "auth"."registration_context" ("expires_at");--> statement-breakpoint
ALTER TABLE "auth"."passkey_capability" ADD CONSTRAINT "passkey_capability_credential_id_passkey_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "auth"."passkey"("credential_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."recovery_code" ADD CONSTRAINT "recovery_code_account_id_user_id_fkey" FOREIGN KEY ("account_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;