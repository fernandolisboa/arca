-- Only app_auth touches step-ups (spec 0003, R5): challenges are issued, consumed with
-- DELETE … RETURNING and swept; assertions are stored, consumed by an UPDATE and swept when unused.
GRANT SELECT, INSERT, DELETE ON "auth"."step_up_challenge" TO app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth"."step_up" TO app_auth;
