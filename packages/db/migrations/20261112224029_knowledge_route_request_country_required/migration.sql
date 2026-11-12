ALTER TABLE "knowledge"."correction_request" DROP CONSTRAINT "correction_request_target", ADD CONSTRAINT "correction_request_target" CHECK (CASE WHEN "item_kind" = 'newRoute'
        THEN "route_id" IS NULL AND "version_number" IS NULL
          AND "country_code" IS NOT NULL AND "country_code" ~ '^[a-z]{2}$'
        ELSE "route_id" IS NOT NULL AND "version_number" IS NOT NULL
          AND "country_code" IS NULL END);