-- Only app_auth touches these (spec 0003, R4). An activation row is written with its passkey and
-- deleted once the passkey is active or gone; a challenge is issued, then deleted when verified
-- or swept once expired. Neither is ever updated.
GRANT SELECT, INSERT, DELETE ON "auth"."passkey_activation" TO app_auth;
GRANT SELECT, INSERT, DELETE ON "auth"."passkey_challenge" TO app_auth;
