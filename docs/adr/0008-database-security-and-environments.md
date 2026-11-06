# ADR-0008: Database roles, row-level security, field encryption, backups and environments

- Status: Accepted; workflow run deletion amended by [ADR-0009](0009-background-jobs-guarantees.md); environments (one Neon project created through Vercel; previews fork from a synthetic `development` branch before any family data exists) amended by [ADR-0012](0012-automation-first-setup.md); backups and deletion amended by [ADR-0017](0017-data-lifecycle-and-backups.md) (backup role with explicit read policies, backup account and drills, account deletion); document encryption and crypto-shredding specified by [ADR-0018](0018-vault-encryption.md); field encryption, the off-vendor backup and AWS removed by [ADR-0021](0021-stay-on-vercel-and-neon.md)
- Date: 2026-11-01

## Context

- Row-level security only protects data if the connecting role cannot bypass it. On Neon, roles created in the console, CLI or API are members of `neon_superuser`, which carries `BYPASSRLS` in projects created after 2023-08-15. An API connected with such a role skips every policy silently.
- Neon branches are copy-on-write copies of their parent. A preview or CI branch cut from production would copy real family data.
- Some fields (bank account numbers, document numbers) are sensitive enough to deserve encryption beyond disk encryption.
- Real family data exists from Phase 1.

## Decision

### Environments

- **Separate Neon projects** for production and non-production (amended by [ADR-0012](0012-automation-first-setup.md): one project; previews fork from a synthetic `development` branch before any family data exists). Non-production branches start from a synthetic seed, never from production.
- Production data never leaves production: no copies to preview, CI or local machines.
- Preview deployments sit behind Vercel Deployment Protection and use non-production secrets only.
- Each environment has its own secrets, held in the platform's environment-variable store and scoped per environment. Vercel services that support it (Vercel Blob) are reached through OIDC, so no long-lived keys exist for them; there is no AWS ([ADR-0021](0021-stay-on-vercel-and-neon.md)).

### Roles (created with SQL, never in the console)

| Role | Purpose | Privileges |
| --- | --- | --- |
| `app_api` | API requests | `NOBYPASSRLS`; DML on case tables, always under RLS; `SELECT` only on knowledge decisions |
| `app_jobs` | Workflow steps | `NOBYPASSRLS`; only the tables its jobs need |
| `app_auth` | Better Auth | Only the auth tables (users, sessions, passkeys), which are not under per-person RLS, and `INSERT` on knowledge decisions, each a copy of a step-up it spends ([spec 0007](../specs/0007-case-model-and-guided-intake.md#r7-activation-and-rejection-adr-0022)) |
| `app_audit` | Audit writer | `INSERT` only on the audit log; no `UPDATE` or `DELETE` for anyone but the migrator |
| `app_migrator` | Schema migrations in the Vercel build ([ADR-0012](0012-automation-first-setup.md)) | DDL; never used by running services |
| `cases_definer` | Owner of the case schema's `SECURITY DEFINER` functions ([spec 0007](../specs/0007-case-model-and-guided-intake.md#r1-case-tables)) | `NOLOGIN`, `NOINHERIT`; only the grants and policies its functions need, in `cases` alone. `app_migrator` may `SET ROLE` to it (no inheritance) to hand it a function, which also lets the migrator read the rows those functions read; the guards pin that membership |

### Row-level security

- `ENABLE` and `FORCE ROW LEVEL SECURITY` on every table with case data, so even table owners are subject to policies.
- The API opens a transaction per request and sets the authenticated identity with `SET LOCAL` (account and case; the account setting is `app.account_id` since [ADR-0015](0015-identity-enrollment-step-up-and-recovery.md)); policies read it from the transaction settings. No identity, no rows.
- Policies are declared with Drizzle and reviewed as security-critical code.
- CI runs an access-matrix suite against a synthetic database: every role and person combination for every table, asserting both allowed and denied access.

### Field-level encryption

- Bank account numbers and identity document numbers are kept in the person's vault, encrypted on the device like documents; the server stores ciphertext only (amended by [ADR-0021](0021-stay-on-vercel-and-neon.md), which replaced KMS envelope encryption).
- Documents themselves are encrypted on the client ([ADR-0018](0018-vault-encryption.md)) and stored as ciphertext in a private Vercel Blob store in São Paulo ([ADR-0021](0021-stay-on-vercel-and-neon.md)).

### Backups and deletion

- Initial targets: RPO 15 minutes, RTO 4 hours.
- Neon point-in-time restore within the plan's history window, and a manual Neon snapshot when the project owner wants one; no off-vendor copy and no drills ([ADR-0021](0021-stay-on-vercel-and-neon.md)), so the RPO above holds only inside that window.
- Deleting a case removes its rows and related data in workflow runs and object storage; telemetry holds no case data to delete ([ADR-0016](0016-observability-and-scrubbing.md)). Documents belong to their owner's account and are shared per account, so deleting a case removes no one's documents. A person's vault identity and envelopes belong to their account and are destroyed (crypto-shredding, [ADR-0018](0018-vault-encryption.md)) only when the account is erased. Point-in-time history keeps deleted rows until the restore window expires; the window is documented and kept as short as the RPO allows.

## Consequences

- A forgotten policy fails closed (no rows), not open.
- Migrations and runtime use different credentials; a compromised API cannot alter the schema or rewrite the audit log.

## Sources

- [Neon docs: roles](https://neon.com/docs/manage/roles/) — `neon_superuser` membership and `BYPASSRLS`; SQL-created roles do not inherit it (checked 2026-11-01)
- [Drizzle ORM: row-level security](https://orm.drizzle.team/docs/rls) (checked 2026-11-01)
