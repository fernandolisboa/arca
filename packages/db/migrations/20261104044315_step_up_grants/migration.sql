-- Only app_auth touches step-ups (spec 0003, R5): challenges are issued, consumed with
-- DELETE … RETURNING and swept; assertions are stored, spent by setting consumed_at (the only
-- column it may update) and swept when never spent.
GRANT SELECT, INSERT, DELETE ON "auth"."step_up_challenge" TO app_auth;
GRANT SELECT, INSERT, DELETE ON "auth"."step_up" TO app_auth;
GRANT UPDATE ("consumed_at") ON "auth"."step_up" TO app_auth;
