CREATE SCHEMA "cases";
--> statement-breakpoint
CREATE TABLE "cases"."asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"case_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value_amount" bigint NOT NULL,
	"value_currency" text NOT NULL,
	"valued_at" date NOT NULL,
	"liquid" boolean,
	"sold" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_id_case_id_key" UNIQUE("id","case_id"),
	CONSTRAINT "asset_kind" CHECK ("kind" IN ('cash', 'investment', 'real_estate', 'business', 'retirement', 'vehicle', 'other')),
	CONSTRAINT "asset_value_amount" CHECK ("value_amount" >= 0),
	CONSTRAINT "asset_value_currency" CHECK ("value_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "asset_sold" CHECK ("sold" = 'none' OR "sold" ~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$')
);
--> statement-breakpoint
ALTER TABLE "cases"."asset" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cases"."asset_owner" (
	"case_id" uuid NOT NULL,
	"asset_id" uuid,
	"person_id" uuid,
	"share" numeric(7,6) NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_owner_pkey" PRIMARY KEY("asset_id","person_id"),
	CONSTRAINT "asset_owner_share" CHECK ("share" > 0 AND "share" <= 1)
);
--> statement-breakpoint
ALTER TABLE "cases"."asset_owner" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cases"."case_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cases"."case_file" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cases"."dependence" (
	"case_id" uuid NOT NULL,
	"person_id" uuid,
	"depends_on_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dependence_pkey" PRIMARY KEY("person_id","depends_on_id"),
	CONSTRAINT "dependence_two_people" CHECK ("person_id" <> "depends_on_id")
);
--> statement-breakpoint
ALTER TABLE "cases"."dependence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cases"."member" (
	"account_id" uuid PRIMARY KEY,
	"case_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_case_id_account_id_key" UNIQUE("case_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "cases"."member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cases"."person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"case_id" uuid NOT NULL,
	"keeper_account_id" uuid NOT NULL,
	"account_id" uuid CONSTRAINT "person_account_id_key" UNIQUE,
	"display_name" text NOT NULL,
	"case_member" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_id_case_id_key" UNIQUE("id","case_id"),
	CONSTRAINT "person_display_name_length" CHECK (char_length("display_name") BETWEEN 1 AND 80 AND "display_name" = btrim("display_name")),
	CONSTRAINT "person_keeps_own_account" CHECK ("account_id" IS NULL OR ("account_id" = "keeper_account_id" AND "case_member"))
);
--> statement-breakpoint
ALTER TABLE "cases"."person" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cases"."person_finances" (
	"person_id" uuid PRIMARY KEY,
	"incomes" jsonb,
	"assets_recorded_in_full" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_finances_incomes_shape" CHECK (jsonb_typeof("incomes") = 'array' AND octet_length("incomes"::text) <= 8192)
);
--> statement-breakpoint
ALTER TABLE "cases"."person_finances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cases"."person_profile" (
	"person_id" uuid PRIMARY KEY,
	"facts" jsonb NOT NULL,
	"dependence_answered" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_profile_facts_shape" CHECK (jsonb_typeof("facts") = 'object' AND octet_length("facts"::text) <= 32768)
);
--> statement-breakpoint
ALTER TABLE "cases"."person_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cases"."relationship" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"case_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_person_id" uuid NOT NULL,
	"to_person_id" uuid NOT NULL,
	"details" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relationship_kind" CHECK ("kind" IN ('spouse', 'partner', 'parent')),
	CONSTRAINT "relationship_two_people" CHECK ("from_person_id" <> "to_person_id"),
	CONSTRAINT "relationship_details_shape" CHECK (jsonb_typeof("details") = 'object' AND octet_length("details"::text) <= 1024)
);
--> statement-breakpoint
ALTER TABLE "cases"."relationship" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cases"."share" (
	"case_id" uuid NOT NULL,
	"person_id" uuid,
	"grantee_account_id" uuid,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_pkey" PRIMARY KEY("person_id","grantee_account_id","scope"),
	CONSTRAINT "share_scope" CHECK ("scope" IN ('profile', 'finances'))
);
--> statement-breakpoint
ALTER TABLE "cases"."share" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "asset_case_id_idx" ON "cases"."asset" ("case_id");--> statement-breakpoint
CREATE INDEX "asset_owner_person_id_idx" ON "cases"."asset_owner" ("person_id");--> statement-breakpoint
CREATE INDEX "dependence_depends_on_id_idx" ON "cases"."dependence" ("depends_on_id");--> statement-breakpoint
CREATE INDEX "person_case_id_idx" ON "cases"."person" ("case_id");--> statement-breakpoint
CREATE INDEX "person_keeper_account_id_idx" ON "cases"."person" ("keeper_account_id");--> statement-breakpoint
CREATE INDEX "relationship_case_id_idx" ON "cases"."relationship" ("case_id");--> statement-breakpoint
CREATE INDEX "relationship_from_person_id_idx" ON "cases"."relationship" ("from_person_id");--> statement-breakpoint
CREATE INDEX "relationship_to_person_id_idx" ON "cases"."relationship" ("to_person_id");--> statement-breakpoint
CREATE INDEX "share_grantee_account_id_idx" ON "cases"."share" ("grantee_account_id");--> statement-breakpoint
ALTER TABLE "cases"."asset" ADD CONSTRAINT "asset_case_id_case_file_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"."case_file"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cases"."asset_owner" ADD CONSTRAINT "asset_owner_asset_fkey" FOREIGN KEY ("asset_id","case_id") REFERENCES "cases"."asset"("id","case_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cases"."asset_owner" ADD CONSTRAINT "asset_owner_person_fkey" FOREIGN KEY ("person_id","case_id") REFERENCES "cases"."person"("id","case_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cases"."dependence" ADD CONSTRAINT "dependence_person_fkey" FOREIGN KEY ("person_id","case_id") REFERENCES "cases"."person"("id","case_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cases"."dependence" ADD CONSTRAINT "dependence_depends_on_fkey" FOREIGN KEY ("depends_on_id","case_id") REFERENCES "cases"."person"("id","case_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cases"."member" ADD CONSTRAINT "member_case_id_case_file_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"."case_file"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cases"."person" ADD CONSTRAINT "person_case_id_case_file_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"."case_file"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cases"."person" ADD CONSTRAINT "person_keeper_fkey" FOREIGN KEY ("case_id","keeper_account_id") REFERENCES "cases"."member"("case_id","account_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cases"."person_finances" ADD CONSTRAINT "person_finances_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "cases"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cases"."person_profile" ADD CONSTRAINT "person_profile_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "cases"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cases"."relationship" ADD CONSTRAINT "relationship_from_person_fkey" FOREIGN KEY ("from_person_id","case_id") REFERENCES "cases"."person"("id","case_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cases"."relationship" ADD CONSTRAINT "relationship_to_person_fkey" FOREIGN KEY ("to_person_id","case_id") REFERENCES "cases"."person"("id","case_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cases"."share" ADD CONSTRAINT "share_person_fkey" FOREIGN KEY ("person_id","case_id") REFERENCES "cases"."person"("id","case_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cases"."share" ADD CONSTRAINT "share_grantee_fkey" FOREIGN KEY ("case_id","grantee_account_id") REFERENCES "cases"."member"("case_id","account_id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "asset_select_owner_visible" ON "cases"."asset" AS PERMISSIVE FOR SELECT TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."asset_owner" WHERE "cases"."asset_owner"."asset_id" = "cases"."asset"."id"));--> statement-breakpoint
CREATE POLICY "asset_update_confirmed_keeper" ON "cases"."asset" AS PERMISSIVE FOR UPDATE TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."asset_owner" WHERE "cases"."asset_owner"."asset_id" = "cases"."asset"."id" AND "cases"."asset_owner"."confirmed" AND EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."asset_owner"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid))) WITH CHECK (EXISTS (SELECT 1 FROM "cases"."asset_owner" WHERE "cases"."asset_owner"."asset_id" = "cases"."asset"."id" AND "cases"."asset_owner"."confirmed" AND EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."asset_owner"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid)));--> statement-breakpoint
CREATE POLICY "asset_delete_confirmed_keeper" ON "cases"."asset" AS PERMISSIVE FOR DELETE TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."asset_owner" WHERE "cases"."asset_owner"."asset_id" = "cases"."asset"."id" AND "cases"."asset_owner"."confirmed" AND EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."asset_owner"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid)));--> statement-breakpoint
CREATE POLICY "asset_select_by_definer" ON "cases"."asset" AS PERMISSIVE FOR SELECT TO "cases_definer" USING (true);--> statement-breakpoint
CREATE POLICY "asset_delete_by_definer" ON "cases"."asset" AS PERMISSIVE FOR DELETE TO "cases_definer" USING (true);--> statement-breakpoint
CREATE POLICY "asset_owner_select_keeper_or_shared" ON "cases"."asset_owner" AS PERMISSIVE FOR SELECT TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."asset_owner"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid) OR EXISTS (SELECT 1 FROM "cases"."share" WHERE "cases"."share"."person_id" = "cases"."asset_owner"."person_id" AND "cases"."share"."grantee_account_id" = nullif(current_setting('app.account_id', true), '')::uuid AND "cases"."share"."scope" = 'finances'));--> statement-breakpoint
CREATE POLICY "asset_owner_update_keeper" ON "cases"."asset_owner" AS PERMISSIVE FOR UPDATE TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."asset_owner"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid)) WITH CHECK (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."asset_owner"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid) AND "cases"."asset_owner"."confirmed");--> statement-breakpoint
CREATE POLICY "asset_owner_delete_keeper" ON "cases"."asset_owner" AS PERMISSIVE FOR DELETE TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."asset_owner"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "asset_owner_select_by_definer" ON "cases"."asset_owner" AS PERMISSIVE FOR SELECT TO "cases_definer" USING (true);--> statement-breakpoint
CREATE POLICY "case_file_select_by_definer" ON "cases"."case_file" AS PERMISSIVE FOR SELECT TO "cases_definer" USING (true);--> statement-breakpoint
CREATE POLICY "case_file_delete_by_definer" ON "cases"."case_file" AS PERMISSIVE FOR DELETE TO "cases_definer" USING (true);--> statement-breakpoint
CREATE POLICY "dependence_select_keeper_or_shared" ON "cases"."dependence" AS PERMISSIVE FOR SELECT TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."dependence"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid) OR EXISTS (SELECT 1 FROM "cases"."share" WHERE "cases"."share"."person_id" = "cases"."dependence"."person_id" AND "cases"."share"."grantee_account_id" = nullif(current_setting('app.account_id', true), '')::uuid AND "cases"."share"."scope" = 'profile'));--> statement-breakpoint
CREATE POLICY "dependence_insert_keeper" ON "cases"."dependence" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."dependence"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "dependence_delete_keeper" ON "cases"."dependence" AS PERMISSIVE FOR DELETE TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."dependence"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "member_select_by_definer" ON "cases"."member" AS PERMISSIVE FOR SELECT TO "cases_definer" USING (true);--> statement-breakpoint
CREATE POLICY "member_select_own_by_jobs" ON "cases"."member" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("cases"."member"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "member_delete_own_by_jobs" ON "cases"."member" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("cases"."member"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "person_insert_keeper" ON "cases"."person" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK ("cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid AND "cases"."person"."account_id" IS NULL);--> statement-breakpoint
CREATE POLICY "person_update_keeper" ON "cases"."person" AS PERMISSIVE FOR UPDATE TO "app_api" USING ("cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK ("cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "person_delete_keeper" ON "cases"."person" AS PERMISSIVE FOR DELETE TO "app_api" USING ("cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "person_select_own_by_jobs" ON "cases"."person" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "person_delete_own_by_jobs" ON "cases"."person" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "person_finances_select_keeper_or_shared" ON "cases"."person_finances" AS PERMISSIVE FOR SELECT TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."person_finances"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid) OR EXISTS (SELECT 1 FROM "cases"."share" WHERE "cases"."share"."person_id" = "cases"."person_finances"."person_id" AND "cases"."share"."grantee_account_id" = nullif(current_setting('app.account_id', true), '')::uuid AND "cases"."share"."scope" = 'finances'));--> statement-breakpoint
CREATE POLICY "person_finances_insert_keeper" ON "cases"."person_finances" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."person_finances"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "person_finances_update_keeper" ON "cases"."person_finances" AS PERMISSIVE FOR UPDATE TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."person_finances"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid)) WITH CHECK (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."person_finances"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "person_finances_delete_keeper" ON "cases"."person_finances" AS PERMISSIVE FOR DELETE TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."person_finances"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "person_profile_select_keeper_or_shared" ON "cases"."person_profile" AS PERMISSIVE FOR SELECT TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."person_profile"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid) OR EXISTS (SELECT 1 FROM "cases"."share" WHERE "cases"."share"."person_id" = "cases"."person_profile"."person_id" AND "cases"."share"."grantee_account_id" = nullif(current_setting('app.account_id', true), '')::uuid AND "cases"."share"."scope" = 'profile'));--> statement-breakpoint
CREATE POLICY "person_profile_insert_keeper" ON "cases"."person_profile" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."person_profile"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "person_profile_update_keeper" ON "cases"."person_profile" AS PERMISSIVE FOR UPDATE TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."person_profile"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid)) WITH CHECK (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."person_profile"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "person_profile_delete_keeper" ON "cases"."person_profile" AS PERMISSIVE FOR DELETE TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."person_profile"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "relationship_insert_keeper" ON "cases"."relationship" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."relationship"."from_person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid) OR EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."relationship"."to_person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "relationship_update_keeper" ON "cases"."relationship" AS PERMISSIVE FOR UPDATE TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."relationship"."from_person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid) OR EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."relationship"."to_person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid)) WITH CHECK (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."relationship"."from_person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid) OR EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."relationship"."to_person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "relationship_delete_keeper" ON "cases"."relationship" AS PERMISSIVE FOR DELETE TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."relationship"."from_person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid) OR EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."relationship"."to_person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "share_select_keeper_or_grantee" ON "cases"."share" AS PERMISSIVE FOR SELECT TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."share"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid) OR "cases"."share"."grantee_account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "share_insert_keeper" ON "cases"."share" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."share"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "share_delete_keeper" ON "cases"."share" AS PERMISSIVE FOR DELETE TO "app_api" USING (EXISTS (SELECT 1 FROM "cases"."person" WHERE "cases"."person"."id" = "cases"."share"."person_id" AND "cases"."person"."keeper_account_id" = nullif(current_setting('app.account_id', true), '')::uuid));