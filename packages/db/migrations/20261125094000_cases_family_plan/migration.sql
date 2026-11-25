CREATE TABLE "cases"."plan_move" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"case_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"stage" integer NOT NULL,
	"route_id" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_move_id_case_id_key" UNIQUE("id","case_id"),
	CONSTRAINT "plan_move_case_id_position_key" UNIQUE("case_id","position"),
	CONSTRAINT "plan_move_case_id_route_id_principal_id_key" UNIQUE("case_id","route_id","principal_id"),
	CONSTRAINT "plan_move_position_range" CHECK ("position" BETWEEN 0 AND 19),
	CONSTRAINT "plan_move_stage_range" CHECK ("stage" BETWEEN 1 AND 6),
	CONSTRAINT "plan_move_route_id_shape" CHECK ("route_id" ~ '^[a-z]{2}-[a-z0-9][a-z0-9-]{0,62}$')
);
--> statement-breakpoint
ALTER TABLE "cases"."plan_move" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cases"."plan_move_dependent" (
	"move_id" uuid,
	"case_id" uuid NOT NULL,
	"person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_move_dependent_pkey" PRIMARY KEY("move_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "cases"."plan_move_dependent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "plan_move_principal_id_idx" ON "cases"."plan_move" ("principal_id");--> statement-breakpoint
CREATE INDEX "plan_move_dependent_person_id_idx" ON "cases"."plan_move_dependent" ("person_id");--> statement-breakpoint
ALTER TABLE "cases"."plan_move" ADD CONSTRAINT "plan_move_principal_fkey" FOREIGN KEY ("principal_id","case_id") REFERENCES "cases"."person"("id","case_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cases"."plan_move_dependent" ADD CONSTRAINT "plan_move_dependent_move_fkey" FOREIGN KEY ("move_id","case_id") REFERENCES "cases"."plan_move"("id","case_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cases"."plan_move_dependent" ADD CONSTRAINT "plan_move_dependent_person_fkey" FOREIGN KEY ("person_id","case_id") REFERENCES "cases"."person"("id","case_id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "plan_move_select_member" ON "cases"."plan_move" AS PERMISSIVE FOR SELECT TO "app_api" USING (cases.is_member("cases"."plan_move"."case_id"));--> statement-breakpoint
CREATE POLICY "plan_move_insert_member" ON "cases"."plan_move" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK (cases.is_member("cases"."plan_move"."case_id"));--> statement-breakpoint
CREATE POLICY "plan_move_delete_member" ON "cases"."plan_move" AS PERMISSIVE FOR DELETE TO "app_api" USING (cases.is_member("cases"."plan_move"."case_id"));--> statement-breakpoint
CREATE POLICY "plan_move_dependent_select_member" ON "cases"."plan_move_dependent" AS PERMISSIVE FOR SELECT TO "app_api" USING (cases.is_member("cases"."plan_move_dependent"."case_id"));--> statement-breakpoint
CREATE POLICY "plan_move_dependent_insert_member" ON "cases"."plan_move_dependent" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK (cases.is_member("cases"."plan_move_dependent"."case_id"));--> statement-breakpoint
CREATE POLICY "plan_move_dependent_delete_member" ON "cases"."plan_move_dependent" AS PERMISSIVE FOR DELETE TO "app_api" USING (cases.is_member("cases"."plan_move_dependent"."case_id"));