-- The account erasure (spec 0004, R9) deletes the account's own rows in every auth entry owned by
-- a column, as app_auth; recovery_lock was the one it could not delete yet.
GRANT DELETE ON "auth"."recovery_lock" TO app_auth;
