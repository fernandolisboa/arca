ALTER TABLE "knowledge"."decision" ADD COLUMN "list_id" text;--> statement-breakpoint
ALTER TABLE "knowledge"."official_domain_list" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge"."update_end" ADD COLUMN "list_hash" text;--> statement-breakpoint
ALTER TABLE "knowledge"."update_request" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "knowledge"."update_request" ADD COLUMN "visa" text;--> statement-breakpoint
ALTER TABLE "knowledge"."update_request" ADD COLUMN "links" text[];--> statement-breakpoint
ALTER TABLE "knowledge"."update_request" ADD COLUMN "list_pins" text[];--> statement-breakpoint
-- One way once a new-route request is stored: such a row has no route or base number.
ALTER TABLE "knowledge"."update_request" ALTER COLUMN "route_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge"."update_request" ALTER COLUMN "base_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge"."official_domain_list" ADD CONSTRAINT "official_domain_list_request_id_key" UNIQUE("request_id");--> statement-breakpoint
CREATE INDEX "update_request_country_requested_idx" ON "knowledge"."update_request" ("country","requested_at");--> statement-breakpoint
-- The insert-only tables withhold REFERENCES from their owner; it is lent for this key only.
GRANT REFERENCES ON "knowledge"."update_request" TO app_migrator;--> statement-breakpoint
ALTER TABLE "knowledge"."official_domain_list" ADD CONSTRAINT "official_domain_list_request_id_update_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "knowledge"."update_request"("id");--> statement-breakpoint
REVOKE REFERENCES ON "knowledge"."update_request" FROM app_migrator;--> statement-breakpoint
ALTER TABLE "knowledge"."update_end" ADD CONSTRAINT "update_end_list_hash" CHECK ("list_hash" IS NULL OR ("failure" IS NULL AND "list_hash" ~ '^[0-9a-f]{64}$'));--> statement-breakpoint
ALTER TABLE "knowledge"."update_request" ADD CONSTRAINT "update_request_shape" CHECK (CASE WHEN "route_id" IS NOT NULL
        THEN "base_number" IS NOT NULL AND "country" IS NULL AND "visa" IS NULL
          AND "links" IS NULL AND "list_pins" IS NULL
        ELSE "base_number" IS NULL AND "country" IS NOT NULL
          AND "country" ~ '^[A-Z]{2}$' AND "visa" IS NOT NULL
          AND char_length("visa") BETWEEN 2 AND 120 AND "links" IS NOT NULL
          AND cardinality("links") <= 10 AND "list_pins" IS NOT NULL
          AND cardinality("list_pins") <= 20
          AND array_to_string("list_pins", ',')
            ~ '^([a-z0-9][a-z0-9-]*/[1-9][0-9]*(,[a-z0-9][a-z0-9-]*/[1-9][0-9]*)*)?$' END);--> statement-breakpoint
ALTER TABLE "knowledge"."decision" DROP CONSTRAINT "decision_subject", ADD CONSTRAINT "decision_subject" CHECK (CASE "subject_kind"
        WHEN 'route' THEN "route_id" IS NOT NULL AND "comparison_id" IS NULL
          AND "list_id" IS NULL
        WHEN 'comparison' THEN "route_id" IS NULL
          AND "comparison_id" IS NOT DISTINCT FROM 'destinations' AND "list_id" IS NULL
        WHEN 'official_domains' THEN "route_id" IS NULL AND "comparison_id" IS NULL
          AND "list_id" ~ '^[a-z0-9][a-z0-9-]{0,63}$' AND "proof" = 'admin_step_up'
        ELSE false END);--> statement-breakpoint
CREATE POLICY "official_domain_list_insert_proposal" ON "knowledge"."official_domain_list" AS PERMISSIVE FOR INSERT TO "app_jobs" WITH CHECK (EXISTS (SELECT FROM "knowledge"."update_end" "ended"
          JOIN "knowledge"."update_request" "asked" ON "asked"."id" = "ended"."request_id"
        WHERE "ended"."request_id" = "knowledge"."official_domain_list"."request_id" AND "ended"."failure" IS NULL
          AND "ended"."list_hash" = "knowledge"."official_domain_list"."content_hash" AND "asked"."route_id" IS NULL
          AND cardinality("asked"."list_pins") = 0 AND "knowledge"."official_domain_list"."list_id" = lower("asked"."country")));--> statement-breakpoint
ALTER POLICY "route_version_insert_proposal" ON "knowledge"."route_version" TO "app_jobs" WITH CHECK (EXISTS (SELECT FROM "knowledge"."update_end" "ended"
          JOIN "knowledge"."update_request" "asked" ON "asked"."id" = "ended"."request_id"
        WHERE "ended"."request_id" = "knowledge"."route_version"."request_id" AND "ended"."failure" IS NULL
          AND "ended"."content_hash" = "knowledge"."route_version"."content_hash"
          AND ("asked"."route_id" = "knowledge"."route_version"."route_id"
            OR ("asked"."route_id" IS NULL AND "knowledge"."route_version"."number" = 1
              AND starts_with("knowledge"."route_version"."route_id", lower("asked"."country") || '-')
              AND "knowledge"."route_version"."content"->>'country' = "asked"."country"))));