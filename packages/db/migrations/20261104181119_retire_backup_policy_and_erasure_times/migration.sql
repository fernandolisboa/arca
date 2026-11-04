-- ADR-0021 retires app_backup's read policy, and the erasure note's times: the tombstone they
-- waited for is gone, so the note is deleted when the `account erased` event is recorded.
DROP POLICY "event_read_by_backup" ON "audit"."event";--> statement-breakpoint
ALTER TABLE "auth"."erased_account" DROP COLUMN "erased_at";--> statement-breakpoint
ALTER TABLE "auth"."erased_account" DROP COLUMN "recorded_at";