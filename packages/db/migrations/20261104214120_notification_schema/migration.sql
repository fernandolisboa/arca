CREATE SCHEMA "notification";
--> statement-breakpoint
CREATE TABLE "notification"."channel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"endpoint" text,
	"p256dh" text,
	"auth_secret" text,
	"browser" text,
	"os" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	CONSTRAINT "channel_id_account_id_key" UNIQUE("id","account_id"),
	CONSTRAINT "channel_fields_by_kind" CHECK (("kind" = 'web_push' AND "endpoint" IS NOT NULL AND "p256dh" IS NOT NULL
            AND "auth_secret" IS NOT NULL AND "browser" IS NOT NULL AND "os" IS NOT NULL)
        OR ("kind" = 'email' AND "endpoint" IS NULL AND "p256dh" IS NULL
            AND "auth_secret" IS NULL AND "browser" IS NULL AND "os" IS NULL)),
	CONSTRAINT "channel_endpoint_https" CHECK ("endpoint" ~ '^https://' AND char_length("endpoint") <= 2048),
	CONSTRAINT "channel_p256dh_format" CHECK ("p256dh" ~ '^[A-Za-z0-9_-]{87}$'),
	CONSTRAINT "channel_auth_secret_format" CHECK ("auth_secret" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "channel_device_format" CHECK ("browser" ~ '^[a-z_]{1,32}$' AND "os" ~ '^[a-z_]{1,32}$')
);
--> statement-breakpoint
ALTER TABLE "notification"."channel" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification"."delivery" (
	"account_id" uuid NOT NULL,
	"message_id" uuid,
	"channel_id" uuid,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_pkey" PRIMARY KEY("message_id","channel_id")
);
--> statement-breakpoint
ALTER TABLE "notification"."delivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification"."message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"account_id" uuid NOT NULL,
	"code" text NOT NULL,
	"entity_id" uuid,
	"details" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_id_account_id_key" UNIQUE("id","account_id"),
	CONSTRAINT "message_code_format" CHECK ("code" ~ '^[a-z_]{1,64}$'),
	CONSTRAINT "message_details_object" CHECK (jsonb_typeof("details") = 'object')
);
--> statement-breakpoint
ALTER TABLE "notification"."message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_email_idx" ON "notification"."channel" ("account_id") WHERE "kind" = 'email';--> statement-breakpoint
CREATE UNIQUE INDEX "channel_endpoint_idx" ON "notification"."channel" ("account_id","endpoint");--> statement-breakpoint
CREATE INDEX "delivery_channel_idx" ON "notification"."delivery" ("channel_id");--> statement-breakpoint
CREATE INDEX "message_account_created_idx" ON "notification"."message" ("account_id","created_at");--> statement-breakpoint
ALTER TABLE "notification"."delivery" ADD CONSTRAINT "delivery_message_fkey" FOREIGN KEY ("message_id","account_id") REFERENCES "notification"."message"("id","account_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification"."delivery" ADD CONSTRAINT "delivery_channel_fkey" FOREIGN KEY ("channel_id","account_id") REFERENCES "notification"."channel"("id","account_id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "channel_select_own" ON "notification"."channel" AS PERMISSIVE FOR SELECT TO "app_api" USING ("notification"."channel"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "channel_insert_own" ON "notification"."channel" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK ("notification"."channel"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "channel_delete_own" ON "notification"."channel" AS PERMISSIVE FOR DELETE TO "app_api" USING ("notification"."channel"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "channel_select_own_by_jobs" ON "notification"."channel" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("notification"."channel"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "channel_insert_own_by_jobs" ON "notification"."channel" AS PERMISSIVE FOR INSERT TO "app_jobs" WITH CHECK ("notification"."channel"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "channel_update_own_by_jobs" ON "notification"."channel" AS PERMISSIVE FOR UPDATE TO "app_jobs" USING ("notification"."channel"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK ("notification"."channel"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "channel_delete_own_by_jobs" ON "notification"."channel" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("notification"."channel"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "delivery_select_own" ON "notification"."delivery" AS PERMISSIVE FOR SELECT TO "app_api" USING ("notification"."delivery"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "delivery_select_own_by_jobs" ON "notification"."delivery" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("notification"."delivery"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "delivery_insert_own_by_jobs" ON "notification"."delivery" AS PERMISSIVE FOR INSERT TO "app_jobs" WITH CHECK ("notification"."delivery"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "delivery_delete_own_by_jobs" ON "notification"."delivery" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("notification"."delivery"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "message_select_own" ON "notification"."message" AS PERMISSIVE FOR SELECT TO "app_api" USING ("notification"."message"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "message_insert_own" ON "notification"."message" AS PERMISSIVE FOR INSERT TO "app_api" WITH CHECK ("notification"."message"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "message_select_own_by_jobs" ON "notification"."message" AS PERMISSIVE FOR SELECT TO "app_jobs" USING ("notification"."message"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "message_insert_own_by_jobs" ON "notification"."message" AS PERMISSIVE FOR INSERT TO "app_jobs" WITH CHECK ("notification"."message"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "message_delete_own_by_jobs" ON "notification"."message" AS PERMISSIVE FOR DELETE TO "app_jobs" USING ("notification"."message"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);