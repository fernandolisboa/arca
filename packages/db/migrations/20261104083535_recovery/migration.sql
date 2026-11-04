CREATE TABLE "auth"."recovery_link" (
	"token_hash" bytea PRIMARY KEY,
	"account_id" uuid NOT NULL UNIQUE,
	"expires_at" timestamp with time zone DEFAULT now() + interval '30 minutes' NOT NULL,
	"redeemed_at" timestamp with time zone,
	"challenge" bytea,
	"challenge_expires_at" timestamp with time zone,
	CONSTRAINT "recovery_link_token_length" CHECK (octet_length("token_hash") = 32),
	CONSTRAINT "recovery_link_challenge" CHECK (("challenge" IS NULL) = ("challenge_expires_at" IS NULL)
          AND ("challenge" IS NULL OR octet_length("challenge") = 32)
          AND ("challenge" IS NULL OR "redeemed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "auth"."recovery_lock" (
	"account_id" uuid PRIMARY KEY,
	"failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auth"."passkey_activation" ADD COLUMN "recovery" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."recovery_code" ADD COLUMN "provisional_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "recovery_link_expires_at_idx" ON "auth"."recovery_link" ("expires_at");--> statement-breakpoint
ALTER TABLE "auth"."recovery_link" ADD CONSTRAINT "recovery_link_account_id_user_id_fkey" FOREIGN KEY ("account_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."recovery_lock" ADD CONSTRAINT "recovery_lock_account_id_user_id_fkey" FOREIGN KEY ("account_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;