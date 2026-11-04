CREATE TABLE "auth"."rate_limit" (
	"key" text PRIMARY KEY,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limit_expires_at_idx" ON "auth"."rate_limit" ("expires_at");