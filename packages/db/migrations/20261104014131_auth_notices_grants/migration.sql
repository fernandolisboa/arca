-- Only app_auth reads and writes the new auth tables, and only as much as the notice code needs
-- (spec 0003, R7 and R8): families are recorded, never edited, and leave with their passkey's
-- cascade; outbox rows are deleted when they expire.
GRANT SELECT, INSERT ON "auth"."passkey_client" TO app_auth;
GRANT SELECT, INSERT, DELETE ON "auth"."outbox" TO app_auth;
