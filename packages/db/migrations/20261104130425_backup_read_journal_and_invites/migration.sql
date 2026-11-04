-- The backup also reads the migration journal, so its manifest can name the head a restore
-- checks, and the invites, whose accepted rows are the lasting link between an inviter and an
-- invitee and the pending confirm-or-decline decision; invites hold only hashes of their tokens.
-- It may use the application schema too, where every table will be backed up (spec 0004, R12).
GRANT USAGE ON SCHEMA "arca_migrations", "app" TO app_backup;
--> statement-breakpoint
GRANT SELECT ON "arca_migrations"."journal", "auth"."invite" TO app_backup;
