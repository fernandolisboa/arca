-- A business's details (ADR-0036): app_api writes them on the asset row like its other fields,
-- under the same row-level policies, so only the keeper of a confirmed owner changes them. A new
-- asset gets them in an update right after `cases.add_asset` creates it, which leaves that function
-- as it is. Reads follow the table's existing grants.
GRANT UPDATE ("country", "operating_since", "employees") ON "cases"."asset" TO app_api;
