CREATE POLICY "asset_insert_by_definer" ON "cases"."asset" AS PERMISSIVE FOR INSERT TO "cases_definer" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "asset_owner_insert_by_definer" ON "cases"."asset_owner" AS PERMISSIVE FOR INSERT TO "cases_definer" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "asset_owner_update_by_definer" ON "cases"."asset_owner" AS PERMISSIVE FOR UPDATE TO "cases_definer" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "case_file_insert_by_definer" ON "cases"."case_file" AS PERMISSIVE FOR INSERT TO "cases_definer" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "member_delete_self" ON "cases"."member" AS PERMISSIVE FOR DELETE TO "app_api" USING ("cases"."member"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "member_insert_by_definer" ON "cases"."member" AS PERMISSIVE FOR INSERT TO "cases_definer" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "person_select_by_definer" ON "cases"."person" AS PERMISSIVE FOR SELECT TO "cases_definer" USING (true);--> statement-breakpoint
CREATE POLICY "person_insert_by_definer" ON "cases"."person" AS PERMISSIVE FOR INSERT TO "cases_definer" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "person_update_by_definer" ON "cases"."person" AS PERMISSIVE FOR UPDATE TO "cases_definer" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "share_select_by_definer" ON "cases"."share" AS PERMISSIVE FOR SELECT TO "cases_definer" USING (true);--> statement-breakpoint
CREATE POLICY "share_delete_by_definer" ON "cases"."share" AS PERMISSIVE FOR DELETE TO "cases_definer" USING (true);