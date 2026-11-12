CREATE TABLE "knowledge"."correction_upload" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"author_account_id" uuid NOT NULL,
	"pathname" text NOT NULL CONSTRAINT "correction_upload_pathname_key" UNIQUE,
	"media_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "correction_upload_pathname_format" CHECK ("pathname" ~ '^corrections/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "correction_upload_media_type" CHECK ("media_type" IN ('application/pdf', 'text/html', 'text/plain')),
	CONSTRAINT "correction_upload_size_range" CHECK ("size" BETWEEN 1 AND 16777216),
	CONSTRAINT "correction_upload_sha256_length" CHECK (octet_length("sha256") = 32)
);
--> statement-breakpoint
ALTER TABLE "knowledge"."correction_upload" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge"."correction_request" ADD COLUMN "content_erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge"."correction_source" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge"."correction_request" ALTER COLUMN "note" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge"."correction_source" ADD CONSTRAINT "correction_source_upload_once" UNIQUE("upload_id");--> statement-breakpoint
CREATE INDEX "correction_upload_author_account_id_idx" ON "knowledge"."correction_upload" ("author_account_id");--> statement-breakpoint
ALTER TABLE "knowledge"."correction_source" ADD CONSTRAINT "correction_source_upload_fkey" FOREIGN KEY ("upload_id") REFERENCES "knowledge"."correction_upload"("id");--> statement-breakpoint
ALTER TABLE "knowledge"."correction_request" ADD CONSTRAINT "correction_request_note_erased" CHECK (("note" IS NULL) = ("content_erased_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "knowledge"."correction_source" DROP CONSTRAINT "correction_source_shape", ADD CONSTRAINT "correction_source_shape" CHECK (CASE "kind"
        WHEN 'link' THEN "text" IS NULL AND "upload_id" IS NULL
          AND "url" ~ '^https://[^[:space:]]+$' AND char_length("url") <= 2048
        WHEN 'text' THEN "url" IS NULL AND "upload_id" IS NULL
          AND char_length("text") BETWEEN 1 AND 20000
        WHEN 'file' THEN "url" IS NULL AND "text" IS NULL
          AND "upload_id" IS NOT NULL
        ELSE false END);--> statement-breakpoint
CREATE POLICY "correction_request_erase_own_by_jobs" ON "knowledge"."correction_request" AS PERMISSIVE FOR UPDATE TO "app_jobs" USING ("knowledge"."correction_request"."author_account_id" = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK ("knowledge"."correction_request"."author_account_id" = nullif(current_setting('app.account_id', true), '')::uuid AND "knowledge"."correction_request"."note" IS NULL);--> statement-breakpoint
CREATE POLICY "correction_source_delete_own_by_jobs" ON "knowledge"."correction_source" AS PERMISSIVE FOR DELETE TO "app_jobs" USING (EXISTS (SELECT FROM "knowledge"."correction_request" "request"
        WHERE "request"."id" = "knowledge"."correction_source"."request_id"
          AND "request"."author_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "correction_upload_insert_by_definer" ON "knowledge"."correction_upload" AS PERMISSIVE FOR INSERT TO "knowledge_definer" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "correction_upload_select_by_definer" ON "knowledge"."correction_upload" AS PERMISSIVE FOR SELECT TO "knowledge_definer" USING (true);--> statement-breakpoint
CREATE POLICY "correction_upload_select_own_by_jobs" ON "knowledge"."correction_upload" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("knowledge"."correction_upload"."author_account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "correction_upload_delete_own_by_jobs" ON "knowledge"."correction_upload" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("knowledge"."correction_upload"."author_account_id" = nullif(current_setting('app.account_id', true), '')::uuid);