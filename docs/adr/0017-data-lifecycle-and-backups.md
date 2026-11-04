# ADR-0017: Data lifecycle: personal-data registry, deletion, export, retention and off-vendor backups

- Status: Accepted
- Date: 2026-11-02
- Amends: [ADR-0008](0008-database-security-and-environments.md) (backups and deletion), [ADR-0012](0012-automation-first-setup.md) (how previews are proven not to fork from production), [ADR-0010](0010-stack-revised.md) (S3 also holds database backups, encrypted at rest only, and the restore runs on AWS CodeBuild)
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

- `packages/db` holds a registry: for every table in a user schema, either an entry (owner column, erase strategy `delete` or `retain`, export projection) or a place on an explicit list of unowned tables with a reason: no personal data, or personal data held only during a short ceremony and swept once expired (spec 0004 R7). A guard test reads the catalog and fails on any table in neither, so a new table cannot ship without a lifecycle decision.
- Deletion and export are driven by the registry only; no slice writes its own deletion code. Each entry names its erasing pool: `app_auth` for the `auth` tables, which have no row-level security, and `app_jobs` for the rest. Every `app_jobs` `delete` entry has a permissive `app_jobs` `DELETE` policy whose qualifier is the request identity on the entry's owner column (`owner = nullif(current_setting('app.account_id', true), '')::uuid`, the form spec 0001 set), plus an `app_jobs` `SELECT` policy with the same qualifier (Postgres applies `SELECT` policies to a filtered `DELETE`), and the guard asserts both: under forced row-level security a missing policy deletes nothing without an error, and a policy of `true` would let one bad step erase every account. Shared data that must survive one person's erasure is modelled so that person's part is their own rows (a join row per recipient, not a list in someone else's row), so plain `delete` covers it; join rows that belong to another person's record are removed with that record by an `ON DELETE CASCADE` foreign key, which row-level security does not block. `retain` (the audit log) keeps rows with identifiers only for a stated period; purging them needs its own ADR, since it changes ADR-0008's insert-only audit log. No foreign key cascades into `auth`, and none leaves `audit`.
- Workflow steps that run as `app_jobs` receive the account ID with the entity ID and set the identity before their first read. The account ID comes from the authenticated session that started the work or from a server-side scan (such as the due-deletion query), never from a client-supplied field.

### Account deletion

- Requested in the app after an `account_deletion` step-up ([ADR-0015](0015-identity-enrollment-step-up-and-recovery.md)). The account is locked at once: every session is revoked, and signing in shows only "cancel deletion".
- After **7 days**, a workflow (`eraseAccount`, identifiers only) first removes its vault objects once the vault exists (while the document rows still hold the object keys; deleting a missing object counts as success, so a retry is idempotent), then erases every registry entry the account owns as `app_jobs` under the account's identity, then its auth rows as `app_auth`, and finally writes an erasure tombstone (account ID and time, nothing else) to the backup account. A security notice goes out when the deletion is requested and when it completes.
- The audit log keeps its records, which hold identifiers and event codes only and point at nothing after erasure. Workflow run payloads and metadata expire on Vercel's schedule ([ADR-0009](0009-background-jobs-guarantees.md)). Telemetry never holds account identifiers ([ADR-0016](0016-observability-and-scrubbing.md)), so there is nothing to delete there.
- Data about a person written by someone else in a shared case follows the case model's rules, which slice 3 of the consultancy core records in the registry.

### Export

- After a `data_export` step-up, the API returns one JSON document, versioned by a schema in `packages/api-contract`, with every registry entry the account owns, served as a download with `Cache-Control: no-store`. It is built on request and never stored. Vault documents are added as ciphertext plus the person's own decryption path once the vault exists.
- Field-encrypted values (bank account and document numbers) are masked in the export and shown only in the app, so a downloaded file never carries them in full; this narrows portability for those fields on purpose.

### Retention

- The schedule lives in [RETENTION.md](../RETENTION.md) and is part of this decision. Every row names its enforcement: a database expiry job, a vendor setting, or a vendor's fixed policy.
- Case data is kept while the account exists. After 3 years without a sign-in, the account gets an email notice; 60 days later it is deleted as above unless someone signs in.

### Previews never fork from production

- The production build's migration runner, as the owner of its schema, writes a lineage mark, a comment on that schema, separate from the database comment that holds spec 0001 R9's endpoint mark. A preview build fails if its database carries the production lineage mark. `development` was branched from production before the mark existed, so its children carry none; a preview forked from production fails the build before migrations run. Once production holds family data (after the real-data gate), `development` is never re-forked from production; it is rebuilt from an empty branch with migrations and the synthetic seed.
- The order is fixed: the first marked production build (done 2026-11-02), then the owner forks `development` and makes it the default branch, then the change that writes the lineage mark merges. The migration runner re-reads both marks in its own transaction.
- Seed data is synthetic, written in previews and CI after migrations through the runtime roles with identities set, so row-level security applies to it. Production builds never seed.

### Off-vendor backups

- A role `app_backup`, created by `bootstrap.sql`, `NOBYPASSRLS` like every other, with `SELECT` only. Every table with row-level security has a permissive `FOR SELECT TO app_backup USING (true)` policy, every table without it has a `SELECT` grant, and a new guard checks both shapes against the catalog (with an explicit not-backed-up list, whose tables it also checks `app_backup` cannot read), so a table cannot silently drop out of the backup or slip into it. Preview builds give `app_backup` a throwaway password generated per build. `app_backup` has no other privilege and appears in no other policy. On the `auth` tables, which are outside row-level security, it reads only what is worth restoring; sessions, challenges, link tokens and rate-limit counters are never backed up.
- A daily Vercel cron starts a workflow (production only) whose step opens a `REPEATABLE READ, READ ONLY` transaction as `app_backup`, streams `COPY … TO STDOUT` of every table into S3 in a **separate AWS account** in São Paulo, into the dumps bucket as objects of at most 64 MB each sent with single conditional `PutObject` calls (no multipart upload, which would need `kms:Decrypt`), and writes a manifest (migration journal head, table list, row counts, SHA-256 per object). It authenticates to AWS through Vercel's OIDC federation; the trusted role accepts only the production environment of project `arca`.
- Three buckets in the backup account, all with versioning, Object Lock in compliance mode for 35 days, server-side encryption with a customer-managed KMS key in that account, public access blocked and TLS required:
  - **dumps**: current versions expire after 35 days and noncurrent versions 1 day later, so a dump is gone by day 36;
  - **document replica**: written by S3 replication from the application account's document bucket, with delete markers replicated. Replication copies only markers from unversioned deletes, so the application roles delete with plain `DeleteObject` and hold no `s3:DeleteObjectVersion`; the 1-day noncurrent rule purges the source; current versions never expire, noncurrent versions expire after 35 days, so a deleted document leaves the replica 35 days after its deletion;
  - **tombstones**: erasure tombstones, expiring after 35 days like the dumps they correct.
- The writer role has `s3:PutObject` on the dumps and tombstones buckets and `kms:GenerateDataKey` only; it cannot read objects (no `s3:GetObject`), decrypt (no `kms:Decrypt`, which single-part uploads do not need) or delete. A separate restore role, outside Vercel, is for the owner under MFA.
- The backup account is created by the owner from a CloudFormation template in the repository, launched once; agents never hold AWS credentials.
- Restores (drill or real) run in a CodeBuild project inside the backup account, from an image built from a pinned repository commit by a separate CodeBuild project in the same account (which has no access to backups, keys or secrets) and pinned by digest, in a VPC whose egress allows only TCP 5432 to the internet and HTTPS to the account's S3, KMS and Secrets Manager VPC endpoints, started by the owner after MFA and loading into a new Neon branch of the production project; no backup is ever read on a laptop. Spec 0004 R12 holds the procedure, its fixed order and its checks; it is normative, and this ADR records only the guarantees:
  - **A chosen backup cannot be altered by a compromised production writer.** Every key is written once (conditional writes required by the bucket policy), keys carry the run ID and a per-attempt random ID, the manifest written last is the only index, and the restore refuses ambiguous manifests, runs whose S3-set timestamps fall outside their date's window, and keys with more than one version. Residual, accepted: a writer that adds a run inside the current day's window while compromised, which the owner sees as a second run.
  - **The load bypasses row-level security only through table ownership on the restore branch**, granted for the load and revoked before success, and guards 1 to 10 and the lineage mark run in a read-only verify mode before the branch can take traffic; the endpoint mark is rewritten for the new branch in spec 0001 R9's reviewed step.
  - **A real restore loses no security event, erasure or deletion request recorded after the backup** (audit records copied from the surviving branch and replayed while the API is blocked at the edge; an account is erased only when an `account_erased` event or a tombstone is backed by a `deletion requested` event, which every erasure path writes with its reason, at least 7 days older with no later cancellation (any age for a declined or unconfirmed invited account that was never confirmed), anything else being decided by the project owner one by one, and the project owner confirms the full list of erasures before they apply, entries left out keeping their accounts with no pending deletion; audit times are set by the database, never by the inserting role), and every account is then told to check its devices and regenerate its kit, since credentials come back as they were at the backup.
  - A quarterly drill restores a backup into a throwaway branch (every other drill one older than the last migration, plus a variant that runs the real-restore fixes on synthetic data), checks it and records the result.
  - Residual, accepted: before each run the owner resets the Neon owner's password on the restore branch only (Neon roles are per branch, so production's password never leaves Neon), stores it in AWS Secrets Manager for the run, never in plain variables or logs, and deletes the branch (drill) or resets the password again (real restore) afterwards. A real restore also reads the old production branch's audit log through a restore-prefixed fork of it, on which the project owner resets `app_backup`'s password the same way; production's `app_backup` password never leaves Vercel, and the fork is deleted after the run. The run's logs go to a KMS-encrypted log group kept 35 days, and the script prints table names and error codes, never row contents.
- Neon's point-in-time restore stays the first line (6 hours on the Free plan, RPO well under ADR-0008's 15 minutes inside that window); the daily copy covers losses noticed later and the loss of the Neon or Vercel account. The document bucket of the application account is replicated into the backup account's document replica bucket (client-side ciphertext). Residual, accepted: the field-encryption KMS key cannot leave the application account, so losing that account loses the encrypted fields.

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
- A deleted account's rows survive in the backups for up to 36 days and in Neon history for up to 6 hours; RETENTION.md says so.
- RPO is under 15 minutes inside Neon's history window and up to 24 hours beyond it or after losing the Neon or Vercel account.

## Sources

- [Neon: history window](https://neon.com/docs/postgres/backup-restore/history-window) (checked 2026-11-02)
- [Vercel: connect to AWS with OIDC](https://vercel.com/docs/oidc/aws) (checked 2026-11-02)
- [Vercel: runtime logs](https://vercel.com/docs/runtime-logs) — 1 day on Pro (checked 2026-11-02)
- [Amazon S3: SSE-KMS permissions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingKMSEncryption.html) — `PutObject` needs `kms:GenerateDataKey`; multipart uploads also need `kms:Decrypt` (checked 2026-11-02)
