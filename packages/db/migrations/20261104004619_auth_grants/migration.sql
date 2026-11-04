-- Better Auth's tables are read and written only by app_auth (spec 0003, R1). No other runtime role
-- gets any privilege on the auth schema; the access tests check it.
GRANT USAGE ON SCHEMA "auth" TO app_auth;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth"."user", "auth"."session", "auth"."account", "auth"."verification", "auth"."passkey" TO app_auth;
