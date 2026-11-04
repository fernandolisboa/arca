ALTER TABLE "auth"."user" ADD COLUMN "deletion_reason" text;--> statement-breakpoint
-- Every deletion requested before reasons were stored was the owner's own.
UPDATE "auth"."user" SET "deletion_reason" = 'owner_request' WHERE "deletion_due_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."user" ADD CONSTRAINT "user_deletion_reason" CHECK (("deletion_due_at" IS NULL) = ("deletion_reason" IS NULL)
          AND "deletion_reason" IN ('owner_request', 'inactivity', 'invite_declined', 'invite_unconfirmed'));