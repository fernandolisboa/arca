-- Database roles (spec 0001, R7). The only place roles are created; adding one is a reviewed change
-- here. tooling/scripts/src/db/bootstrap.ts runs this file as the database owner role, in one
-- transaction with createrole_self_grant empty, and fills each password placeholder with a
-- generated password whose alphabet it checks. It is idempotent: it creates missing roles and
-- resets their attributes and passwords, and changes nothing else.
--
-- SUPERUSER is never named: only a superuser may set it, and the guards reject any role that has it.

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['app_migrator', 'app_api', 'app_jobs', 'app_auth', 'app_audit'] LOOP
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE pg_catalog.format('CREATE ROLE %I', role_name);
    END IF;
    EXECUTE pg_catalog.format(
      'ALTER ROLE %I LOGIN INHERIT NOBYPASSRLS NOREPLICATION NOCREATEROLE NOCREATEDB',
      role_name
    );
  END LOOP;
END
$$;

ALTER ROLE app_migrator PASSWORD '{{app_migrator}}';
ALTER ROLE app_api PASSWORD '{{app_api}}';
ALTER ROLE app_jobs PASSWORD '{{app_jobs}}';
ALTER ROLE app_auth PASSWORD '{{app_auth}}';

-- The migrator creates the application schema and the migration journal.
DO $$
BEGIN
  EXECUTE pg_catalog.format('GRANT CREATE ON DATABASE %I TO app_migrator', pg_catalog.current_database());
END
$$;
