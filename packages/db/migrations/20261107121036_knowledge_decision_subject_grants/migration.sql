-- app_auth names the subject kind, and the comparison ID of a comparison decision, when it stores a
-- decision (ADR-0026). app_api already reads every column of the table.
GRANT INSERT ("subject_kind", "comparison_id") ON "knowledge"."decision" TO app_auth;
