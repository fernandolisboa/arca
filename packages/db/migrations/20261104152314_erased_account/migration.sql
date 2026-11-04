CREATE TABLE "auth"."erased_account" (
	"account_id" uuid PRIMARY KEY,
	"erased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_at" timestamp with time zone
);
