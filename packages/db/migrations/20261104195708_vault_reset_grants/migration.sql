-- Resetting a vault (spec 0005, R2): app_api deletes the account's own recipients, whose
-- envelopes go by their cascade, and its sharing state, under row-level security.
GRANT DELETE ON "vault"."recipient", "vault"."sharing_state" TO app_api;
