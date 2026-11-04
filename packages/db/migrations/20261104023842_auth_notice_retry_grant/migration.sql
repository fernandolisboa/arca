-- A notice that fails to send forgets the family it recorded, so the next sign-in retries it
-- (spec 0003, R7).
GRANT DELETE ON "auth"."passkey_client" TO app_auth;
