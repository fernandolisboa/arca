# ADR-0021: Stay on Vercel and Neon: no AWS

- Status: Accepted; amended 2026-11-12 by [ADR-0029](0029-correction-requests-and-the-corrector-session.md): the Blob store also holds owner-list admins' plaintext copies of official texts attached to correction requests
- Date: 2026-11-04
- Supersedes: the off-vendor backups of [ADR-0017](0017-data-lifecycle-and-backups.md#off-vendor-backups)
- Amends: [ADR-0008](0008-database-security-and-environments.md) (field encryption, backups), [ADR-0010](0010-stack-revised.md) (object storage and keys), [ADR-0018](0018-vault-encryption.md) (document storage, field encryption), [ADR-0015](0015-identity-enrollment-step-up-and-recovery.md) (the `app_backup` grant)

## Context

The accepted design put three things on AWS in São Paulo:

- a separate backup account receiving a daily copy of the database, with Object Lock, a restore job on CodeBuild and quarterly drills ([ADR-0017](0017-data-lifecycle-and-backups.md));
- an application account for document ciphertext in S3;
- KMS for the field-encryption keys ([ADR-0008](0008-database-security-and-environments.md), [ADR-0018](0018-vault-encryption.md)).

On 2026-11-04, when the backup ticket (#75) came up, the project owner rejected all of it. Arca serves one family. A second cloud vendor, two AWS accounts, a CloudFormation template, a restore pipeline and a quarterly drill are more machinery than the risk calls for, and every piece adds owner chores. The owner already stores files in Vercel Blob for another app.

Facts checked on 2026-11-04:

- Neon's Free plan keeps 6 hours of point-in-time restore history (1 GB of changes) and allows 1 manual snapshot. Launch keeps up to 7 days and adds scheduled snapshots ([Neon: plans](https://neon.com/docs/introduction/plans)). A Neon restore keeps the state it replaced as a backup branch.
- Vercel Blob has private stores, readable only with authentication, in any of Vercel's regions, São Paulo included. Projects reach a connected store through OIDC with no long-lived secret. The browser can upload directly with a client token our API issues ([Vercel Blob](https://vercel.com/docs/vercel-blob)).

## Decision

- **No AWS.** Arca runs on Vercel and Neon only, plus the observability vendors of [ADR-0016](0016-observability-and-scrubbing.md). No AWS account, template, role, key or SDK.
- **Backups are Neon's own.**
  - Point-in-time restore inside the plan's history window (6 hours on Free).
  - Optionally, a manual snapshot the project owner takes in Neon's console before a risky change.
  - There is no daily dump, no off-vendor copy and no restore drill.
  - The incident runbook's restore is Neon's restore. The events recorded after the restore point are read from the backup branch Neon keeps, and re-applied as the runbook says.
  - Moving to a paid Neon plan for a longer window is the owner's call, made in Neon's console with no code change.
- **No erasure tombstones.** They existed so a restore from the daily copy would not bring an erased account back. A Neon restore reaches back at most the history window, and the erasures inside it are visible in the backup branch's audit log. So the tombstone step and its port are removed, and the erasure workflow ends at the `account erased` event.
- **`app_backup` is retired.** It existed only for the daily copy. Its read policy, grants, guard 10 and production password are removed in the change that ends #75. The role itself stays, unable to log in and holding nothing, because migrations already applied grant to it and must still replay on a new database. The erasure tests count rows as the test server's admin.
- **Documents go to a private Vercel Blob store in São Paulo**, one per environment, holding client-side ciphertext only (and, since [ADR-0029](0029-correction-requests-and-the-corrector-session.md), plaintext copies of official texts attached to correction requests, under their own prefix) ([ADR-0018](0018-vault-encryption.md) is otherwise unchanged).
  - The browser uploads with a client token our API issues after the `vault_write` step-up.
  - Downloads are served through our API, or through a short-lived signed URL after the `vault_unlock` step-up.
  - The store's upload origin joins `connect-src` in place of the S3 bucket's. The exact origin is checked when the vault's storage ticket lands.
  - Deleting a document deletes its blob. A store keeps no old versions, so nothing lingers after a replace or delete beyond the CDN's 60-second propagation.
- **No server-side field encryption.** Bank account and identity document numbers live in the person's vault as small encrypted items, sealed on the device to the same recipients as documents. The server stores ciphertext only and never decrypts them.
  - The case model keeps no such number in clear.
  - A feature that needs one, such as filling a form draft, decrypts it on the device.
  - Approving a change of bank details by two people ([CLAUDE.md](../../CLAUDE.md)) still records the change and both approvals on the server. Each approver reads the new details from their own vault share.

## Alternatives

| Option | Why not |
| --- | --- |
| The AWS design as accepted | One family's app; the owner rejected the extra vendor and its chores |
| Daily `pg_dump` into Vercel Blob | Rejected with the AWS copy: same machinery, and no protection if the Vercel account is lost |
| Field encryption with a key in a Vercel Sensitive variable | A key every function can read gives little over row-level security, and composing it would be home-made cryptography |
| Neon Launch plan now | A cost the owner has not chosen; the window is a console setting he can change later |

## Consequences

- Losing the Neon or Vercel account loses the data. The project owner accepted this on 2026-11-04. ADR-0008's off-vendor copy and its 24-hour RPO beyond the history window no longer hold. RPO is near zero inside the history window and unbounded beyond it, except for a manual snapshot.
- A deleted account's rows survive only in Neon history, for at most the history window. Its document blobs are gone once deleted.
- The owner's setup list loses the AWS account, the template and the drills. Connecting a Blob store to the project is one click when the vault's storage ticket lands.
- Tickets change:
  - #75 closes;
  - #80 becomes creating the Blob store;
  - #82 stores documents in Blob;
  - #83 closes, its fields moving into the vault.

  Specs 0004 R12 and 0005 R3 and R6 are amended to match.

## Sources

- [Neon: plans](https://neon.com/docs/introduction/plans): restore window, snapshots (checked 2026-11-04)
- [Vercel Blob](https://vercel.com/docs/vercel-blob): private stores, regions, OIDC, client uploads, no overwrite by default (checked 2026-11-04)
