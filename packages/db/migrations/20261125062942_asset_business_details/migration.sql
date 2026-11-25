ALTER TABLE "cases"."asset" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "cases"."asset" ADD COLUMN "operating_since" text;--> statement-breakpoint
ALTER TABLE "cases"."asset" ADD COLUMN "employees" integer;--> statement-breakpoint
ALTER TABLE "cases"."asset" ADD CONSTRAINT "asset_country" CHECK ("country" ~ '^([A-Z]{2}|[A-Z]{4})$');--> statement-breakpoint
ALTER TABLE "cases"."asset" ADD CONSTRAINT "asset_operating_since" CHECK ("operating_since" ~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$');--> statement-breakpoint
ALTER TABLE "cases"."asset" ADD CONSTRAINT "asset_employees" CHECK ("employees" BETWEEN 0 AND 10000000);--> statement-breakpoint
ALTER TABLE "cases"."asset" ADD CONSTRAINT "asset_business_fields" CHECK ("kind" = 'business' OR ("country" IS NULL AND "operating_since" IS NULL AND "employees" IS NULL));