-- Notifications (spec 0005, R7). app_api serves the account's own rows under row-level security:
-- it adds and removes push channels, adds messages, and reads deliveries for the data export. app_jobs adds messages for the daily jobs
-- and the email channel, records deliveries, updates a channel's last success, deletes a channel
-- the push service reports gone, and erases and expires the account's rows, always under the
-- account's identity. No other role reaches the schema; the access tests check it.
ALTER TABLE "notification"."channel" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification"."message" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification"."delivery" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "notification" TO app_api, app_jobs;
--> statement-breakpoint
GRANT SELECT ON "notification"."channel", "notification"."message", "notification"."delivery" TO app_api;
--> statement-breakpoint
GRANT SELECT ON "notification"."channel", "notification"."message", "notification"."delivery" TO app_jobs;
--> statement-breakpoint
GRANT INSERT ("account_id", "kind", "endpoint", "p256dh", "auth_secret", "browser", "os") ON "notification"."channel" TO app_api;
--> statement-breakpoint
GRANT DELETE ON "notification"."channel" TO app_api, app_jobs;
--> statement-breakpoint
GRANT INSERT ("account_id", "kind") ON "notification"."channel" TO app_jobs;
--> statement-breakpoint
GRANT UPDATE ("last_success_at") ON "notification"."channel" TO app_jobs;
--> statement-breakpoint
GRANT INSERT ("account_id", "code", "entity_id", "details") ON "notification"."message" TO app_api, app_jobs;
--> statement-breakpoint
GRANT DELETE ON "notification"."message" TO app_jobs;
--> statement-breakpoint
GRANT INSERT ("account_id", "message_id", "channel_id") ON "notification"."delivery" TO app_jobs;
--> statement-breakpoint
GRANT DELETE ON "notification"."delivery" TO app_jobs;
