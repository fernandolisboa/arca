-- The erasure (spec 0004, R9) notes each erased account as app_auth, marks its event recorded, and
-- deletes the note once the tombstone is written.
GRANT SELECT, INSERT, DELETE ON "auth"."erased_account" TO app_auth;
GRANT UPDATE ("recorded_at") ON "auth"."erased_account" TO app_auth;
