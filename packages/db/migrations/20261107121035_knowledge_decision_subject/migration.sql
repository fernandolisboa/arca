-- Every decision stored before comparisons existed is on a route version (ADR-0026). The default
-- only fills those rows: it is dropped at once, so every new decision names its subject kind.
ALTER TABLE "knowledge"."decision" ADD COLUMN "subject_kind" text DEFAULT 'route' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ALTER COLUMN "subject_kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ADD COLUMN "comparison_id" text;--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ALTER COLUMN "route_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ADD CONSTRAINT "decision_subject" CHECK (CASE "subject_kind"
        WHEN 'route' THEN "route_id" IS NOT NULL AND "comparison_id" IS NULL
        WHEN 'comparison' THEN "route_id" IS NULL
          AND "comparison_id" IS NOT DISTINCT FROM 'destinations'
        ELSE false END);