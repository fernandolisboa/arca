-- No corrector key made before ADR-0031 (#463) may still open the corrector's definer functions:
-- knowledge_definer loses SELECT on the key digest, so live_corrector_key(), and every function that
-- checks a key through it, fails closed. The data export reads only a row's kind, time and author.
REVOKE SELECT ON "knowledge"."corrector_key" FROM knowledge_definer;
--> statement-breakpoint
GRANT SELECT ("id", "kind", "revokes_key_id", "actor_account_id", "step_up_id", "at") ON "knowledge"."corrector_key" TO knowledge_definer;
