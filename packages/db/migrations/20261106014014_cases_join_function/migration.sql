-- Joining a case after an invite (spec 0007, R2), as cases_definer. join_case reads the identity
-- itself, takes the case's transaction lock and names every row it touches.
--
-- A member adds an account that is in no case: as a new person with the given name, or taking
-- over target_person, a person the caller keeps who has no account, whose shares are dropped so
-- the new keeper decides who sees it. Answers 'joined';
-- 'unchanged' when the account is already in the caller's case, so a retry changes nothing;
-- 'case_exists' when it is in another case; 'not_found' otherwise. The API first checks, under the
-- caller's identity, that an account.link joins the two accounts, so cases_definer stays confined
-- to its schema (guard 6); it also holds the case's size limits, which every member can count.
CREATE FUNCTION "cases"."join_case"(invitee uuid, target_person uuid, display_name text) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    caller uuid := nullif(current_setting('app.account_id', true), '')::uuid;
    target_case uuid;
    invitee_case uuid;
  BEGIN
    SELECT m.case_id INTO target_case FROM "cases"."member" m WHERE m.account_id = caller;
    IF target_case IS NULL OR invitee IS NULL OR invitee = caller THEN
      RETURN 'not_found';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cases.case_file:' || target_case::text, 0));
    SELECT m.case_id INTO invitee_case FROM "cases"."member" m WHERE m.account_id = invitee;
    IF invitee_case = target_case THEN
      RETURN 'unchanged';
    ELSIF invitee_case IS NOT NULL THEN
      RETURN 'case_exists';
    END IF;
    IF (target_person IS NULL AND display_name IS NULL) OR (target_person IS NOT NULL AND NOT EXISTS (
      SELECT FROM "cases"."person" p
       WHERE p.id = target_person AND p.case_id = target_case AND p.keeper_account_id = caller
         AND p.account_id IS NULL)) THEN
      RETURN 'not_found';
    END IF;
    -- The account creating or joining another case at the same time waits here, then inserts nothing.
    INSERT INTO "cases"."member" (account_id, case_id) VALUES (invitee, target_case)
      ON CONFLICT (account_id) DO NOTHING;
    IF NOT FOUND THEN
      RETURN 'case_exists';
    END IF;
    IF target_person IS NULL THEN
      INSERT INTO "cases"."person" (case_id, keeper_account_id, account_id, display_name, case_member)
        VALUES (target_case, invitee, invitee, display_name, true);
    ELSE
      UPDATE "cases"."person" p SET keeper_account_id = invitee, account_id = invitee, case_member = true
       WHERE p.id = target_person;
      DELETE FROM "cases"."share" s WHERE s.person_id = target_person;
    END IF;
    RETURN 'joined';
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "cases"."join_case"(uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint
-- Granted while the migrator still owns it, since only the owner may grant.
GRANT EXECUTE ON FUNCTION "cases"."join_case"(uuid, uuid, text) TO app_api;
--> statement-breakpoint
GRANT UPDATE ("account_id", "case_member") ON "cases"."person" TO cases_definer;
--> statement-breakpoint
-- ALTER ... OWNER needs the new owner to hold CREATE on the schema; it holds it only meanwhile.
GRANT CREATE ON SCHEMA "cases" TO cases_definer;
--> statement-breakpoint
ALTER FUNCTION "cases"."join_case"(uuid, uuid, text) OWNER TO cases_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "cases" FROM cases_definer;
