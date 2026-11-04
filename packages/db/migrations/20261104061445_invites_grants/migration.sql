-- Only app_auth touches invites (spec 0003, R2). An invite is issued, then accepted once (the
-- acceptance columns are the only ones that change), and deleted when it expires, is replaced or
-- its account is declined.
GRANT SELECT, INSERT, DELETE ON "auth"."invite" TO app_auth;
GRANT UPDATE ("accepted_at", "accepted_account_id") ON "auth"."invite" TO app_auth;
