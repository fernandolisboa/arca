-- The new auth tables, like the others, are read and written only by app_auth (spec 0003, R7 and R8).
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth"."passkey_client", "auth"."outbox" TO app_auth;
