CREATE TABLE "auth"."outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '7 days' NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."passkey_client" (
	"credential_id" text,
	"browser" text,
	"os" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passkey_client_pkey" PRIMARY KEY("credential_id","browser","os")
);
--> statement-breakpoint
CREATE INDEX "outbox_created_at_idx" ON "auth"."outbox" ("created_at");--> statement-breakpoint
ALTER TABLE "auth"."passkey_client" ADD CONSTRAINT "passkey_client_credential_id_passkey_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "auth"."passkey"("credential_id") ON DELETE CASCADE;