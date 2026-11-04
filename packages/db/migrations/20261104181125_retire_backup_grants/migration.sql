-- app_backup is retired with the daily backup (ADR-0021). Bootstrap keeps the role without login
-- only so the migrations that granted to it still replay on a new database; it holds nothing now.
REVOKE SELECT ON "auth"."user", "auth"."passkey", "auth"."passkey_activation", "auth"."passkey_capability", "auth"."passkey_client", "auth"."recovery_code", "auth"."recovery_lock", "auth"."step_up", "auth"."setup", "auth"."invite", "audit"."event", "arca_migrations"."journal" FROM app_backup;
--> statement-breakpoint
REVOKE USAGE ON SCHEMA "auth", "audit", "arca_migrations", "app" FROM app_backup;
