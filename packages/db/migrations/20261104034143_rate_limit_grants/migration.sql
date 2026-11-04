-- Only app_auth reads and writes the counters (spec 0003, R10): one upsert per request, and the
-- daily cleanup deletes expired windows.
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth"."rate_limit" TO app_auth;
