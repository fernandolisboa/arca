ALTER TABLE "knowledge"."correction_event" ADD COLUMN "update_request_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge"."correction_request" ADD COLUMN "request_kind" text DEFAULT 'correction' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge"."correction_event" ADD CONSTRAINT "correction_event_update_request_key" UNIQUE("update_request_id");--> statement-breakpoint
-- The insert-only tables withhold REFERENCES from their owner; it is lent for this key only.
GRANT REFERENCES ON "knowledge"."update_request" TO app_migrator;--> statement-breakpoint
ALTER TABLE "knowledge"."correction_event" ADD CONSTRAINT "correction_event_update_request_id_update_request_id_fkey" FOREIGN KEY ("update_request_id") REFERENCES "knowledge"."update_request"("id");--> statement-breakpoint
REVOKE REFERENCES ON "knowledge"."update_request" FROM app_migrator;--> statement-breakpoint
ALTER TABLE "knowledge"."correction_event" ADD CONSTRAINT "correction_event_update_request" CHECK (("update_request_id" IS NOT NULL) = ("kind" = 'released'));--> statement-breakpoint
ALTER TABLE "knowledge"."correction_request" ADD CONSTRAINT "correction_request_request_kind" CHECK ("request_kind" IN ('correction', 'update'));--> statement-breakpoint
ALTER TABLE "knowledge"."correction_request" ADD CONSTRAINT "correction_request_update_names_version" CHECK ("request_kind" <> 'update' OR ("item_kind" = 'version' AND "item_key" IS NULL));--> statement-breakpoint
ALTER TABLE "knowledge"."correction_event" DROP CONSTRAINT "correction_event_kind", ADD CONSTRAINT "correction_event_kind" CHECK ("kind" IN ('taken', 'answered', 'closed', 'released', 'declined'));--> statement-breakpoint
ALTER TABLE "knowledge"."correction_request" DROP CONSTRAINT "correction_request_note_erased", ADD CONSTRAINT "correction_request_note_erased" CHECK (CASE WHEN "content_erased_at" IS NOT NULL THEN "note" IS NULL
        ELSE "note" IS NOT NULL OR "request_kind" = 'update' END);--> statement-breakpoint
ALTER TABLE "knowledge"."correction_event" DROP CONSTRAINT "correction_event_shape", ADD CONSTRAINT "correction_event_shape" CHECK (CASE "kind"
        WHEN 'released' THEN "corrector_key_id" IS NULL AND "proposed_version" IS NULL
          AND "explanation" IS NULL AND "proposed_route_id" IS NULL
        WHEN 'declined' THEN "corrector_key_id" IS NULL AND "proposed_version" IS NULL
          AND "proposed_route_id" IS NULL
          AND coalesce(char_length("explanation") BETWEEN 1 AND 500, true)
        WHEN 'closed' THEN "corrector_key_id" IS NULL AND "proposed_version" IS NULL
          AND "explanation" IS NULL AND "proposed_route_id" IS NULL
        WHEN 'taken' THEN "corrector_key_id" IS NOT NULL AND "proposed_version" IS NULL
          AND "explanation" IS NULL AND "proposed_route_id" IS NULL
        WHEN 'answered' THEN "corrector_key_id" IS NOT NULL
          AND ("proposed_version" IS NULL) <> ("explanation" IS NULL)
          AND ("proposed_route_id" IS NULL OR ("proposed_version" IS NOT NULL
            AND "proposed_route_id" ~ '^[a-z]{2}-[a-z0-9][a-z0-9-]{0,62}$'))
          AND coalesce("proposed_version" > 0, true)
          AND coalesce(char_length("explanation") BETWEEN 1 AND 2000, true)
        ELSE false END);