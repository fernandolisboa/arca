-- Session reviews (ADR-0032). The migrator, which owns the table, stores a review's activations as
-- `session_review` rows, the only rows its insert policy admits. A decision is never changed or
-- deleted, so the owner gives up what row-level security would not stop for it: TRUNCATE, and the
-- rest with it, as for the rule rows.
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "knowledge"."decision" FROM app_migrator;
