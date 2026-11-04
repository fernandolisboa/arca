-- Only app_auth touches enrollment (spec 0003, R2 and R6). Spent enrollment codes are only ever
-- added, never changed or removed; registration contexts are issued, then deleted when spent or
-- swept; recovery codes are replaced and confirmed, never moved to another account, and go with
-- the account by its cascade; capabilities are written once per passkey.
GRANT SELECT, INSERT ON "auth"."setup" TO app_auth;
GRANT SELECT, INSERT, DELETE ON "auth"."registration_context" TO app_auth;
GRANT SELECT, INSERT ON "auth"."recovery_code" TO app_auth;
GRANT UPDATE ("salt", "code_hash", "created_at", "confirmed_at") ON "auth"."recovery_code" TO app_auth;
GRANT SELECT, INSERT ON "auth"."passkey_capability" TO app_auth;
