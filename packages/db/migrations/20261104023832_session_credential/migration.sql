-- Every session now names the passkey that signed it in; a session without one cannot be kept.
DELETE FROM "auth"."session";--> statement-breakpoint
ALTER TABLE "auth"."session" ADD COLUMN "credential_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."passkey" ADD CONSTRAINT "passkey_credential_user_key" UNIQUE("credential_id","user_id");--> statement-breakpoint
CREATE INDEX "session_credential_id_idx" ON "auth"."session" ("credential_id");--> statement-breakpoint
ALTER TABLE "auth"."session" ADD CONSTRAINT "session_credential_fkey" FOREIGN KEY ("credential_id","user_id") REFERENCES "auth"."passkey"("credential_id","user_id") ON DELETE CASCADE;