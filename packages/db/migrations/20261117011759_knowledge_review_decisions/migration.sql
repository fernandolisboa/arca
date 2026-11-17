CREATE TABLE "knowledge"."version_edit" (
	"route_id" text,
	"number" integer,
	"item_key" text NOT NULL,
	"url" text NOT NULL,
	"quote" text NOT NULL,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "version_edit_pkey" PRIMARY KEY("route_id","number"),
	CONSTRAINT "version_edit_item_key_length" CHECK (char_length("item_key") BETWEEN 1 AND 120),
	CONSTRAINT "version_edit_url_length" CHECK (char_length("url") BETWEEN 1 AND 2000),
	CONSTRAINT "version_edit_quote_length" CHECK (char_length("quote") BETWEEN 1 AND 2000)
);
--> statement-breakpoint
ALTER TABLE "knowledge"."version_edit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY "decision_insert_session" ON "knowledge"."decision";--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ADD COLUMN "cases_hash" text;--> statement-breakpoint
ALTER TABLE "knowledge"."route_version" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge"."route_version" ADD CONSTRAINT "route_version_request_id_key" UNIQUE("request_id");--> statement-breakpoint
-- The insert-only tables withhold REFERENCES from their owner; it is lent for these two keys only.
GRANT REFERENCES ON "knowledge"."update_request", "knowledge"."route_version" TO app_migrator;--> statement-breakpoint
ALTER TABLE "knowledge"."route_version" ADD CONSTRAINT "route_version_request_id_update_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "knowledge"."update_request"("id");--> statement-breakpoint
ALTER TABLE "knowledge"."version_edit" ADD CONSTRAINT "version_edit_version_fkey" FOREIGN KEY ("route_id","number") REFERENCES "knowledge"."route_version"("route_id","number");--> statement-breakpoint
REVOKE REFERENCES ON "knowledge"."update_request", "knowledge"."route_version" FROM app_migrator;--> statement-breakpoint
ALTER TABLE "knowledge"."decision" ADD CONSTRAINT "decision_cases_hash" CHECK ("cases_hash" IS NULL OR ("proof" = 'admin_step_up' AND "cases_hash" ~ '^[0-9a-f]{64}$'));--> statement-breakpoint
ALTER TABLE "knowledge"."decision" DROP CONSTRAINT "decision_proof", ADD CONSTRAINT "decision_proof" CHECK (CASE "proof"
        WHEN 'step_up' THEN "admin_basis" IS NULL AND "admin_grant_id" IS NULL
          AND "credential_id" IS NOT NULL AND "public_key" IS NOT NULL
          AND "action_nonce" IS NOT NULL AND "server_nonce" IS NOT NULL
          AND "authenticator_data" IS NOT NULL AND "client_data_json" IS NOT NULL
          AND "signature" IS NOT NULL AND "step_up_id" IS NOT NULL
        WHEN 'session' THEN CASE "admin_basis" WHEN 'owner_list' THEN "admin_grant_id" IS NULL
        WHEN 'grant' THEN "admin_grant_id" IS NOT NULL ELSE false END
          AND "credential_id" IS NULL AND "public_key" IS NULL
          AND "action_nonce" IS NULL AND "server_nonce" IS NULL
          AND "authenticator_data" IS NULL AND "client_data_json" IS NULL
          AND "signature" IS NULL AND "step_up_id" IS NULL
        WHEN 'admin_step_up' THEN CASE "admin_basis" WHEN 'owner_list' THEN "admin_grant_id" IS NULL
        WHEN 'grant' THEN "admin_grant_id" IS NOT NULL ELSE false END
          AND "credential_id" IS NOT NULL AND "public_key" IS NOT NULL
          AND "action_nonce" IS NOT NULL AND "server_nonce" IS NOT NULL
          AND "authenticator_data" IS NOT NULL AND "client_data_json" IS NOT NULL
          AND "signature" IS NOT NULL AND "step_up_id" IS NOT NULL
          AND ("cases_hash" IS NOT NULL) = ("subject_kind" = 'route')
        ELSE false END);--> statement-breakpoint
CREATE POLICY "decision_insert_with_step_up" ON "knowledge"."decision" AS PERMISSIVE FOR INSERT TO "app_auth" WITH CHECK ("knowledge"."decision"."proof" = 'admin_step_up' AND "knowledge"."decision"."approver_account_id" = nullif(current_setting('app.account_id', true), '')::uuid
        AND ("knowledge"."decision"."admin_basis" = 'owner_list'
          OR EXISTS (SELECT FROM "knowledge"."admin_grant" "given"
        WHERE "given"."id" = "knowledge"."decision"."admin_grant_id" AND "given"."kind" = 'grant'
          AND "given"."grantee_account_id" = "knowledge"."decision"."approver_account_id"))
        AND EXISTS (SELECT FROM "auth"."step_up"
          WHERE "auth"."step_up"."id" = "knowledge"."decision"."step_up_id"
            AND "auth"."step_up"."account_id" = "knowledge"."decision"."approver_account_id"
            AND "auth"."step_up"."purpose" = 'knowledge_decision'
            AND "auth"."step_up"."consumed_at" IS NOT NULL
            AND "auth"."step_up"."credential_id" = "knowledge"."decision"."credential_id"
            AND "auth"."step_up"."nonce" = "knowledge"."decision"."server_nonce"
            AND "auth"."step_up"."authenticator_data" = "knowledge"."decision"."authenticator_data"
            AND "auth"."step_up"."client_data_json" = "knowledge"."decision"."client_data_json"
            AND "auth"."step_up"."signature" = "knowledge"."decision"."signature"));--> statement-breakpoint
CREATE POLICY "route_version_insert_proposal" ON "knowledge"."route_version" AS PERMISSIVE FOR INSERT TO "app_jobs" WITH CHECK (EXISTS (SELECT FROM "knowledge"."update_end" "ended"
          JOIN "knowledge"."update_request" "asked" ON "asked"."id" = "ended"."request_id"
        WHERE "ended"."request_id" = "knowledge"."route_version"."request_id" AND "ended"."failure" IS NULL
          AND "ended"."content_hash" = "knowledge"."route_version"."content_hash"
          AND "asked"."route_id" = "knowledge"."route_version"."route_id"));--> statement-breakpoint
CREATE POLICY "route_version_read_definer" ON "knowledge"."route_version" AS PERMISSIVE FOR SELECT TO "knowledge_definer" USING (true);--> statement-breakpoint
CREATE POLICY "route_version_insert_edit" ON "knowledge"."route_version" AS PERMISSIVE FOR INSERT TO "knowledge_definer" WITH CHECK ("knowledge"."route_version"."request_id" IS NULL);--> statement-breakpoint
CREATE POLICY "version_edit_read" ON "knowledge"."version_edit" AS PERMISSIVE FOR SELECT TO "app_api" USING (true);--> statement-breakpoint
CREATE POLICY "version_edit_insert_by_definer" ON "knowledge"."version_edit" AS PERMISSIVE FOR INSERT TO "knowledge_definer" WITH CHECK (true);