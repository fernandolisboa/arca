-- Settings › IA (ADR-0031). app_auth inserts a key row's columns, never its time, in the
-- transaction that spends the actor's ai_key step-up, under the insert policy. app_api reads the
-- key rows and the stage settings; app_jobs reads them too, without who set a key. A stage setting is written
-- only through set_ai_stage, owned by knowledge_definer, which has no access to the key rows.
-- Nobody updates or deletes either table.
ALTER TABLE "knowledge"."ai_key" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge"."ai_stage_setting" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT INSERT ("id", "provider", "kind", "ciphertext", "nonce", "tag", "kek_version", "format_version", "last_four", "removes_key_id", "actor_account_id", "step_up_id") ON "knowledge"."ai_key" TO app_auth;
--> statement-breakpoint
-- app_migrator owns both tables and gives up changing, deleting and truncating their rows.
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "knowledge"."ai_key", "knowledge"."ai_stage_setting" FROM app_migrator;
--> statement-breakpoint
GRANT SELECT ON "knowledge"."ai_key", "knowledge"."ai_stage_setting" TO app_api;
--> statement-breakpoint
GRANT SELECT ("id", "provider", "kind", "ciphertext", "nonce", "tag", "kek_version", "format_version", "last_four", "removes_key_id", "at") ON "knowledge"."ai_key" TO app_jobs;
--> statement-breakpoint
GRANT SELECT ON "knowledge"."ai_stage_setting" TO app_jobs;
--> statement-breakpoint
GRANT INSERT ("id", "stage", "model", "effort") ON "knowledge"."ai_stage_setting" TO knowledge_definer;
--> statement-breakpoint
-- An admin, the transaction's account, chooses the model and effort of a stage; the API checked
-- them against the reviewed list first. Answers the new row's ID.
CREATE FUNCTION "knowledge"."set_ai_stage"(stage_arg text, model_arg text, effort_arg text, basis text, grant_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    stored uuid := pg_catalog.gen_random_uuid();
  BEGIN
    IF NOT "knowledge"."admin_basis_holds"(basis, grant_id) THEN
      RAISE EXCEPTION 'only an admin chooses AI models' USING ERRCODE = '42501';
    END IF;
    INSERT INTO "knowledge"."ai_stage_setting" (id, stage, model, effort)
      VALUES (stored, stage_arg, model_arg, effort_arg);
    RETURN stored;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."set_ai_stage"(text, text, text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
-- Granted while the migrator still owns it, since only the owner may grant.
GRANT EXECUTE ON FUNCTION "knowledge"."set_ai_stage"(text, text, text, text, uuid) TO app_api;
--> statement-breakpoint
-- ALTER ... OWNER needs the new owner to hold CREATE on the schema; it holds it only meanwhile.
GRANT CREATE ON SCHEMA "knowledge" TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."set_ai_stage"(text, text, text, text, uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "knowledge" FROM knowledge_definer;
