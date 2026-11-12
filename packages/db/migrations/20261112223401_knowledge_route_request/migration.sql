ALTER TABLE "knowledge"."correction_event" ADD COLUMN "proposed_route_id" text;--> statement-breakpoint
ALTER TABLE "knowledge"."correction_request" ADD COLUMN "country_code" text;--> statement-breakpoint
ALTER TABLE "knowledge"."correction_request" ALTER COLUMN "route_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge"."correction_request" ALTER COLUMN "version_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge"."correction_request" ADD CONSTRAINT "correction_request_target" CHECK (CASE WHEN "item_kind" = 'newRoute'
        THEN "route_id" IS NULL AND "version_number" IS NULL
          AND "country_code" IS NOT NULL AND "country_code" ~ '^[a-z]{2}$'
        ELSE "route_id" IS NOT NULL AND "version_number" IS NOT NULL
          AND "country_code" IS NULL END);--> statement-breakpoint
ALTER TABLE "knowledge"."correction_request" DROP CONSTRAINT "correction_request_item_kind", ADD CONSTRAINT "correction_request_item_kind" CHECK ("item_kind" IN ('newRoute', 'version', 'settings', 'requirement', 'assessment', 'dependent', 'cost', 'duration', 'countrySet'));--> statement-breakpoint
ALTER TABLE "knowledge"."correction_request" DROP CONSTRAINT "correction_request_item_key", ADD CONSTRAINT "correction_request_item_key" CHECK (CASE WHEN "item_kind" IN ('newRoute', 'version', 'settings') THEN "item_key" IS NULL
        ELSE "item_key" ~ '^[a-z0-9][a-z0-9./-]{0,79}$' END);--> statement-breakpoint
ALTER TABLE "knowledge"."correction_source" DROP CONSTRAINT "correction_source_position_range", ADD CONSTRAINT "correction_source_position_range" CHECK ("position" BETWEEN 0 AND 19);--> statement-breakpoint
ALTER TABLE "knowledge"."correction_source" DROP CONSTRAINT "correction_source_shape", ADD CONSTRAINT "correction_source_shape" CHECK (CASE "kind"
        WHEN 'link' THEN "text" IS NULL AND "upload_id" IS NULL
          AND "page_url" IS NULL
          AND "url" ~ '^https://[^[:space:]]+$' AND char_length("url") <= 2048
        WHEN 'text' THEN "upload_id" IS NULL
          AND "page_url" IS NULL AND char_length("text") BETWEEN 1 AND 20000
          AND ("url" IS NULL OR ("url" ~ '^https://[^[:space:]]+$'
            AND char_length("url") <= 2048))
        WHEN 'file' THEN "url" IS NULL AND "text" IS NULL
          AND "upload_id" IS NOT NULL
          AND ("page_url" IS NULL OR ("page_url" ~ '^https://[^[:space:]]+$'
            AND char_length("page_url") <= 2048))
        ELSE false END);--> statement-breakpoint
ALTER TABLE "knowledge"."correction_event" DROP CONSTRAINT "correction_event_shape", ADD CONSTRAINT "correction_event_shape" CHECK (CASE "kind"
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