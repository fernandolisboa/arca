-- The daily backup reads, as app_backup, the tables worth restoring (spec 0004, R12): accounts,
-- passkeys with their waits, capabilities and device families, recovery-code hashes and lockouts,
-- step-up assertions, spent enrollment codes and the audit log. Never sessions, challenges, link
-- tokens, invites, rate-limit counters or the outbox, which are short-lived and would put live
-- tokens in a backup. It may only read; guard 10 checks the catalog.
GRANT USAGE ON SCHEMA "auth", "audit" TO app_backup;
--> statement-breakpoint
GRANT SELECT ON "auth"."user", "auth"."passkey", "auth"."passkey_activation", "auth"."passkey_capability", "auth"."passkey_client", "auth"."recovery_code", "auth"."recovery_lock", "auth"."step_up", "auth"."setup" TO app_backup;
--> statement-breakpoint
GRANT SELECT ON "audit"."event" TO app_backup;
