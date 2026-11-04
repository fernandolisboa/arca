CREATE TABLE "auth"."invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"inviter_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" bytea NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '48 hours' NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_account_id" uuid UNIQUE,
	CONSTRAINT "invite_token_length" CHECK (octet_length("token_hash") = 32),
	CONSTRAINT "invite_accepted_together" CHECK (("accepted_at" IS NULL) = ("accepted_account_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "invite_inviter_id_idx" ON "auth"."invite" ("inviter_id");--> statement-breakpoint
CREATE INDEX "invite_expires_at_idx" ON "auth"."invite" ("expires_at");--> statement-breakpoint
ALTER TABLE "auth"."invite" ADD CONSTRAINT "invite_inviter_id_user_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."invite" ADD CONSTRAINT "invite_accepted_account_id_user_id_fkey" FOREIGN KEY ("accepted_account_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;