# ADR-0017: Data lifecycle: personal-data registry, deletion, export, retention and off-vendor backups

- Status: Accepted
- Date: 2026-11-02
- Amends: [ADR-0008](0008-database-security-and-environments.md) (backups and deletion), [ADR-0012](0012-automation-first-setup.md) (how previews are proven not to fork from production)
- Spec: [0004 real-data readiness](../specs/0004-real-data-readiness.md)

## Context

Before real family data enters, ROADMAP and SECURITY.md require in-app account deletion and data export, retention periods per data type, backups with an off-vendor copy, and previews that fork from a synthetic `development` branch. ADR-0008 and ADR-0012 set the goals; these points were open:

- **Knowing where personal data is.** Deletion and export are only as complete as the list of tables they cover. Tables are added by many slices.
- **Undo and coercion.** An immediate, irreversible deletion is one stolen phone away; a deletion that never completes fails the person and the LGPD.
- **Backups under forced row-level security.** Every role is `NOBYPASSRLS` and every case table forces row-level security (guard 4, ADR-0008), so a logical dump as any of our roles sees no rows. Only the Neon owner bypasses it, and only build scripts may read its credentials in code (a lint rule), though running functions can reach them (accepted in ADR-0012).
- **Proving previews do not fork from production.** ADR-0012 makes `development` the default branch before the first case-data table, which is one click by the owner. Nothing checks it was done, or that it stays done.

Facts checked on 2026-11-02:

- Neon's Free plan keeps 6 hours of history (1 GB) for point-in-time restore; Launch up to 7 days; Scale up to 30 days ([Neon: history window](https://neon.com/docs/postgres/backup-restore/history-window)).
- Vercel functions get short-lived OIDC tokens; AWS trusts them through an IAM identity provider for `oidc.vercel.com/<team>`, with the token's `sub` naming the team, project and environment, so a role can trust production only ([Vercel: connect to AWS](https://vercel.com/docs/oidc/aws)).
- Vercel Pro keeps runtime logs for 1 day ([Vercel: runtime logs](https://vercel.com/docs/runtime-logs)).

## Decision

### Personal-data registry

- `packages/db` holds a registry: for every table in a user schema, either an entry (owner column, erase strategy `delete`, `detach` or `retain`, export projection) or a place on an explicit "no personal data" list with a reason. A guard test reads the catalog and fails on any table in neither, so a new table cannot ship without a lifecycle decision.
- Deletion and export are driven by the registry only; no slice writes its own deletion code. Every entry has a permissive `app_jobs` policy for its erase command, checked by the guard, because under forced row-level security a missing policy deletes nothing without an error. `retain` (the audit log) keeps rows with identifiers only for a stated period; purging them needs its own ADR, since it changes ADR-0008's insert-only audit log. No foreign key cascades into `auth`, and none leaves `audit`.
- Workflow steps that run as `app_jobs` receive the account ID with the entity ID and set the identity before their first read.

### Account deletion

- Requested in the app after an `account_deletion` step-up ([ADR-0015](0015-identity-enrollment-step-up-and-recovery.md)). The account is locked at once: every session is revoked, and signing in shows only "cancel deletion".
- After **7 days**, a workflow (`eraseAccount`, identifiers only) erases every registry entry the account owns as `app_jobs` under the account's identity, removes its vault objects and keys once the vault exists, then its auth rows as `app_auth`. A security notice goes out when the deletion is requested and when it completes.
- The audit log keeps its records, which hold identifiers and event codes only and point at nothing after erasure. Workflow run payloads and metadata expire on Vercel's schedule ([ADR-0009](0009-background-jobs-guarantees.md)). Telemetry never holds account identifiers ([ADR-0016](0016-observability-and-scrubbing.md)), so there is nothing to delete there.
- Data about a person written by someone else in a shared case follows the case model's rules, which slice 3 of the consultancy core records in the registry.

### Export

- After a `data_export` step-up, the API returns one JSON document, versioned by a schema in `packages/api-contract`, with every registry entry the account owns, served as a download with `Cache-Control: no-store`. It is built on request and never stored. Vault documents are added as ciphertext plus the person's own decryption path once the vault exists.

### Retention

- The schedule lives in [RETENTION.md](../RETENTION.md) and is part of this decision. Every row names its enforcement: a database expiry job, a vendor setting, or a vendor's fixed policy.
- Case data is kept while the account exists. After 3 years without a sign-in, the account gets an email notice; 60 days later it is deleted as above unless someone signs in.

### Previews never fork from production

- The production build writes a lineage mark, a comment on the migration runner's schema, separate from the database comment that holds spec 0001 R9's endpoint mark. A preview build fails if its database carries the production lineage mark. `development` was branched from production before the mark existed, so its children carry none; a preview forked from production fails the build before migrations run.
- The order is fixed: the first marked production build (done 2026-11-02), then the owner forks `development` and makes it the default branch, then the change that writes the lineage mark merges. The migration runner re-reads both marks in its own transaction.
- Seed data is synthetic, written in previews and CI after migrations through the runtime roles with identities set, so row-level security applies to it. Production builds never seed.

### Off-vendor backups

- A role `app_backup`, created by `bootstrap.sql`, `NOBYPASSRLS` like every other, with `SELECT` only. Every table with row-level security has a permissive `FOR SELECT TO app_backup USING (true)` policy, every table without it has a `SELECT` grant, and a new guard checks both shapes against the catalog (with an explicit not-backed-up list), so a table cannot silently drop out of the backup. Preview builds give `app_backup` a throwaway password generated per build. `app_backup` has no other privilege and appears in no other policy. On the `auth` tables, which are outside row-level security, it reads only what is worth restoring; sessions, challenges, link tokens and rate-limit counters are never backed up.
- A daily Vercel cron starts a workflow (production only) whose step opens a `REPEATABLE READ, READ ONLY` transaction as `app_backup`, streams `COPY … TO STDOUT` of every table into S3 in a **separate AWS account** in São Paulo, as objects of at most 64 MB each sent with single `PutObject` calls (no multipart upload, which would need `kms:Decrypt`), and writes a manifest (migration journal head, table list, row counts, SHA-256 per object). It authenticates to AWS through Vercel's OIDC federation; the trusted role accepts only the production environment of project `arca`.
- The bucket: versioning, Object Lock in compliance mode for 35 days, server-side encryption with a customer-managed KMS key in that account, public access blocked, TLS required. The writer role has `s3:PutObject` and `kms:GenerateDataKey` only; it cannot read objects (no `s3:GetObject`), decrypt (no `kms:Decrypt`, which single-part uploads do not need) or delete. A separate restore role, outside Vercel, is for the owner under MFA.
- The backup account is created by the owner from a CloudFormation template in the repository, launched once; agents never hold AWS credentials.
- A quarterly restore drill follows the incident runbook: restore the latest backup into a throwaway Neon branch of the production project, compare row counts and hashes with the manifest, delete the branch, record the result.
- Neon's point-in-time restore stays the first line (6 hours on the Free plan, RPO well under ADR-0008's 15 minutes inside that window); the daily copy covers losses noticed later and the loss of the Neon or Vercel account. The document bucket of the application account is replicated into the backup account (client-side ciphertext). Residual, accepted: the field-encryption KMS key cannot leave the application account, so losing that account loses the encrypted fields.

## Alternatives

| Option | Why not |
| --- | --- |
| Immediate deletion | One stolen or coerced session erases everything with no undo |
| Soft delete kept indefinitely | Not deletion under the LGPD |
| A backup role with `BYPASSRLS` | Breaks guard 4's "nobody bypasses" invariant; explicit read policies keep coverage reviewable |
| Backups through the Neon owner from GitHub Actions | Puts the owner connection string in GitHub, which the owner would have to copy by hand |
| Client-side encryption of backups to an offline owner key | Adds a key the owner must keep and use for every drill; the threat it answers (AWS reading the copy) is covered by KMS with no `Decrypt` for the writer |
| Paid Neon plan for a longer restore window instead of the off-vendor copy | Does not survive the loss of the Neon or Vercel account, which ADR-0008 requires |

## Consequences

- Every slice that adds a table adds a registry entry and an `app_backup` read policy in the same migration, or its guards fail.
- The owner creates an AWS account and launches one template; the restore drill needs the owner each quarter.
- The backup runs with a role that can read every row; its password is a Sensitive Vercel variable like the others, readable by running functions, which ADR-0012 already accepts for the owner string.
- A deleted account's rows survive in the backups for up to 35 days and in Neon history for up to 6 hours; RETENTION.md says so.

## Sources

- [Neon: history window](https://neon.com/docs/postgres/backup-restore/history-window) (checked 2026-11-02)
- [Vercel: connect to AWS with OIDC](https://vercel.com/docs/oidc/aws) (checked 2026-11-02)
- [Vercel: runtime logs](https://vercel.com/docs/runtime-logs) — 1 day on Pro (checked 2026-11-02)
- [Amazon S3: SSE-KMS permissions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingKMSEncryption.html) — `PutObject` needs `kms:GenerateDataKey`; multipart uploads also need `kms:Decrypt` (checked 2026-11-02)
