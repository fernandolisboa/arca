# Drills

Results of the exercises that keep the [incident response runbook](incident-response.md) honest. There is no restore drill: backups are Neon's own ([ADR-0021](../adr/0021-stay-on-vercel-and-neon.md)). Add a row after each one; never write personal data here, since this repository is public.

## Tabletop exercise, every year

A walk through one realistic scenario with the runbook open, without touching production: who notices, what severity, which containment steps in which order, whether the ANPD and the affected people must be told and by when. Each gap found becomes a ticket and a runbook change.

At each exercise, also check in the repository's Actions tab that the weekly smoke run has run in the last week. GitHub turns off scheduled workflows in a public repository after 60 days without activity, and the run is what warns that `security.txt` is about to expire.

| Date | Scenario | Participants | Gaps found | Tickets and changes |
| --- | --- | --- | --- | --- |
| _the first exercise is recorded before the real-data gate_ | | | | |
