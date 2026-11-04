-- Only app_auth touches recovery (spec 0003, R6). A link is issued, redeemed with the recovery
-- code (which swaps its token for the registration's own), given one ceremony challenge at a
-- time and deleted when its passkey registers or a new link replaces it; a lock counts wrong
-- codes. A recovery issues a provisional code, made
-- permanent when its passkey registers, and a cancelled recovery deletes the code it issued.
GRANT SELECT, INSERT, DELETE ON "auth"."recovery_link" TO app_auth;
GRANT UPDATE ("token_hash", "redeemed_at", "challenge", "challenge_expires_at") ON "auth"."recovery_link" TO app_auth;
GRANT SELECT, INSERT ON "auth"."recovery_lock" TO app_auth;
GRANT UPDATE ("failures", "locked_until") ON "auth"."recovery_lock" TO app_auth;
GRANT DELETE ON "auth"."recovery_code" TO app_auth;
GRANT UPDATE ("provisional_until") ON "auth"."recovery_code" TO app_auth;
