CREATE TABLE "knowledge"."country_set" (
	"set_id" text,
	"number" integer,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"inserted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "country_set_pkey" PRIMARY KEY("set_id","number"),
	CONSTRAINT "country_set_set_id_format" CHECK ("set_id" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
	CONSTRAINT "country_set_number_positive" CHECK ("number" > 0),
	CONSTRAINT "country_set_content_hash_format" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "country_set_content_identity" CHECK ("content" ->> 'id' = "set_id"
        AND "content" -> 'number' = pg_catalog.to_jsonb("number"))
);
--> statement-breakpoint
ALTER TABLE "knowledge"."country_set" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "knowledge"."official_domain_list" (
	"list_id" text,
	"number" integer,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"inserted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "official_domain_list_pkey" PRIMARY KEY("list_id","number"),
	CONSTRAINT "official_domain_list_list_id_format" CHECK ("list_id" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
	CONSTRAINT "official_domain_list_number_positive" CHECK ("number" > 0),
	CONSTRAINT "official_domain_list_content_hash_format" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "official_domain_list_content_identity" CHECK ("content" ->> 'id' = "list_id"
        AND "content" -> 'number' = pg_catalog.to_jsonb("number"))
);
--> statement-breakpoint
ALTER TABLE "knowledge"."official_domain_list" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "knowledge"."route_version" (
	"route_id" text,
	"number" integer,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"cases" jsonb,
	"inserted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "route_version_pkey" PRIMARY KEY("route_id","number"),
	CONSTRAINT "route_version_route_id_format" CHECK ("route_id" ~ '^[a-z]{2}-[a-z0-9][a-z0-9-]{0,62}$'),
	CONSTRAINT "route_version_number_positive" CHECK ("number" > 0),
	CONSTRAINT "route_version_content_hash_format" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "route_version_content_identity" CHECK ("content" ->> 'routeId' = "route_id"
        AND "content" -> 'number' = pg_catalog.to_jsonb("number"))
);
--> statement-breakpoint
ALTER TABLE "knowledge"."route_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "country_set_read" ON "knowledge"."country_set" AS PERMISSIVE FOR SELECT TO "app_api", "app_jobs" USING (true);--> statement-breakpoint
CREATE POLICY "country_set_import_read" ON "knowledge"."country_set" AS PERMISSIVE FOR SELECT TO "app_migrator" USING (true);--> statement-breakpoint
CREATE POLICY "country_set_import" ON "knowledge"."country_set" AS PERMISSIVE FOR INSERT TO "app_migrator" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "official_domain_list_read" ON "knowledge"."official_domain_list" AS PERMISSIVE FOR SELECT TO "app_api", "app_jobs" USING (true);--> statement-breakpoint
CREATE POLICY "official_domain_list_import_read" ON "knowledge"."official_domain_list" AS PERMISSIVE FOR SELECT TO "app_migrator" USING (true);--> statement-breakpoint
CREATE POLICY "official_domain_list_import" ON "knowledge"."official_domain_list" AS PERMISSIVE FOR INSERT TO "app_migrator" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "route_version_read" ON "knowledge"."route_version" AS PERMISSIVE FOR SELECT TO "app_api", "app_jobs" USING (true);--> statement-breakpoint
CREATE POLICY "route_version_import_read" ON "knowledge"."route_version" AS PERMISSIVE FOR SELECT TO "app_migrator" USING (true);--> statement-breakpoint
CREATE POLICY "route_version_import" ON "knowledge"."route_version" AS PERMISSIVE FOR INSERT TO "app_migrator" WITH CHECK (true);