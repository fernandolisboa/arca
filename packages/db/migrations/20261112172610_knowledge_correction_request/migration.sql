CREATE TABLE "knowledge"."correction_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "correction_event_closed_once" UNIQUE("request_id","kind"),
	CONSTRAINT "correction_event_kind" CHECK ("kind" = 'closed')
);
--> statement-breakpoint
ALTER TABLE "knowledge"."correction_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "knowledge"."correction_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"route_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"item_kind" text NOT NULL,
	"item_key" text,
	"note" text NOT NULL,
	"author_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "correction_request_route_id_format" CHECK ("route_id" ~ '^[a-z]{2}-[a-z0-9][a-z0-9-]{0,62}$'),
	CONSTRAINT "correction_request_version_number_positive" CHECK ("version_number" > 0),
	CONSTRAINT "correction_request_item_kind" CHECK ("item_kind" IN ('version', 'settings', 'requirement', 'assessment', 'dependent', 'cost', 'duration', 'countrySet')),
	CONSTRAINT "correction_request_item_key" CHECK (CASE WHEN "item_kind" IN ('version', 'settings') THEN "item_key" IS NULL
        ELSE "item_key" ~ '^[a-z0-9][a-z0-9./-]{0,79}$' END),
	CONSTRAINT "correction_request_note_length" CHECK (char_length("note") BETWEEN 1 AND 4000)
);
--> statement-breakpoint
ALTER TABLE "knowledge"."correction_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "knowledge"."correction_source" (
	"request_id" uuid,
	"position" integer,
	"kind" text NOT NULL,
	"url" text,
	"text" text,
	CONSTRAINT "correction_source_pkey" PRIMARY KEY("request_id","position"),
	CONSTRAINT "correction_source_position_range" CHECK ("position" BETWEEN 0 AND 4),
	CONSTRAINT "correction_source_shape" CHECK (CASE "kind"
        WHEN 'link' THEN "text" IS NULL AND "url" ~ '^https://[^[:space:]]+$'
          AND char_length("url") <= 2048
        WHEN 'text' THEN "url" IS NULL AND char_length("text") BETWEEN 1 AND 20000
        ELSE false END)
);
--> statement-breakpoint
ALTER TABLE "knowledge"."correction_source" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "correction_request_version_idx" ON "knowledge"."correction_request" ("route_id","version_number");--> statement-breakpoint
CREATE INDEX "correction_request_author_account_id_idx" ON "knowledge"."correction_request" ("author_account_id");--> statement-breakpoint
ALTER TABLE "knowledge"."correction_event" ADD CONSTRAINT "correction_event_request_fkey" FOREIGN KEY ("request_id") REFERENCES "knowledge"."correction_request"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "knowledge"."correction_source" ADD CONSTRAINT "correction_source_request_fkey" FOREIGN KEY ("request_id") REFERENCES "knowledge"."correction_request"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "admin_grant_read_definer" ON "knowledge"."admin_grant" AS PERMISSIVE FOR SELECT TO "knowledge_definer" USING (true);--> statement-breakpoint
CREATE POLICY "correction_event_insert_by_definer" ON "knowledge"."correction_event" AS PERMISSIVE FOR INSERT TO "knowledge_definer" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "correction_event_select_by_definer" ON "knowledge"."correction_event" AS PERMISSIVE FOR SELECT TO "knowledge_definer" USING (true);--> statement-breakpoint
CREATE POLICY "correction_event_select_own" ON "knowledge"."correction_event" AS PERMISSIVE FOR SELECT TO "app_api" USING (EXISTS (SELECT FROM "knowledge"."correction_request" "request"
        WHERE "request"."id" = "knowledge"."correction_event"."request_id"
          AND "request"."author_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "correction_event_select_own_by_jobs" ON "knowledge"."correction_event" AS PERMISSIVE FOR SELECT TO "app_jobs" USING (EXISTS (SELECT FROM "knowledge"."correction_request" "request"
        WHERE "request"."id" = "knowledge"."correction_event"."request_id"
          AND "request"."author_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "correction_request_insert_by_definer" ON "knowledge"."correction_request" AS PERMISSIVE FOR INSERT TO "knowledge_definer" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "correction_request_select_by_definer" ON "knowledge"."correction_request" AS PERMISSIVE FOR SELECT TO "knowledge_definer" USING (true);--> statement-breakpoint
CREATE POLICY "correction_request_select_own" ON "knowledge"."correction_request" AS PERMISSIVE FOR SELECT TO "app_api" USING ("knowledge"."correction_request"."author_account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "correction_request_select_own_by_jobs" ON "knowledge"."correction_request" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("knowledge"."correction_request"."author_account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "correction_request_delete_own_by_jobs" ON "knowledge"."correction_request" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("knowledge"."correction_request"."author_account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "correction_source_insert_by_definer" ON "knowledge"."correction_source" AS PERMISSIVE FOR INSERT TO "knowledge_definer" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "correction_source_select_by_definer" ON "knowledge"."correction_source" AS PERMISSIVE FOR SELECT TO "knowledge_definer" USING (true);--> statement-breakpoint
CREATE POLICY "correction_source_select_own" ON "knowledge"."correction_source" AS PERMISSIVE FOR SELECT TO "app_api" USING (EXISTS (SELECT FROM "knowledge"."correction_request" "request"
        WHERE "request"."id" = "knowledge"."correction_source"."request_id"
          AND "request"."author_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "correction_source_select_own_by_jobs" ON "knowledge"."correction_source" AS PERMISSIVE FOR SELECT TO "app_jobs" USING (EXISTS (SELECT FROM "knowledge"."correction_request" "request"
        WHERE "request"."id" = "knowledge"."correction_source"."request_id"
          AND "request"."author_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));