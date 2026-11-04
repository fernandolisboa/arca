# Drills

Results of the exercises that keep the [incident response runbook](incident-response.md) and the off-vendor backups ([spec 0004 R12](../specs/0004-real-data-readiness.md#r12-off-vendor-backups)) honest. Add a row after each one; never write personal data here, since this repository is public.

## Restore drill, every quarter

A real restore of a recent backup into a throwaway Neon branch, following R12. Every other quarter, restore a backup older than the last migration, so both restore paths stay exercised.

| Date | Backup restored | Older than last migration? | Image digest | Image source commit | Row counts and hashes match | Guards pass | Time taken | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _none yet: the first drill is recorded when the backups land_ | | | | | | | | |

## Tabletop exercise, every year

A walk through one realistic scenario with the runbook open, without touching production: who notices, what severity, which containment steps in which order, whether the ANPD and the affected people must be told and by when. Each gap found becomes a ticket and a runbook change.

| Date | Scenario | Participants | Gaps found | Tickets and changes |
| --- | --- | --- | --- | --- |
| _the first exercise is recorded before the real-data gate_ | | | | |
