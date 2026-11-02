# ADR-0008: Database roles, row-level security, field encryption, backups and environments

- Status: Accepted; workflow run deletion amended by [ADR-0009](0009-background-jobs-guarantees.md); environments (one Neon project created through Vercel; previews fork from a synthetic `development` branch before any family data exists) amended by [ADR-0012](0012-automation-first-setup.md); backups and deletion amended by [ADR-0017](0017-data-lifecycle-and-backups.md) (backup role with explicit read policies, backup account and drills, account deletion)
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
- Each environment has its own secrets, held in the platform's environment-variable store and scoped per environment. Access from Vercel to AWS uses OIDC federation, so no long-lived AWS keys exist.

### Roles (created with SQL, never in the console)

| Role | Purpose | Privileges |
| --- | --- | --- |
| `app_api` | API requests | `NOBYPASSRLS`; DML on case tables, always under RLS |
| `app_jobs` | Workflow steps | `NOBYPASSRLS`; only the tables its jobs need |
| `app_auth` | Better Auth | Only the auth tables (users, sessions, passkeys), which are not under per-person RLS |
| `app_audit` | Audit writer | `INSERT` only on the audit log; no `UPDATE` or `DELETE` for anyone but the migrator |
| `app_migrator` | Schema migrations in the Vercel build ([ADR-0012](0012-automation-first-setup.md)) | DDL; never used by running services |

### Row-level security

- `ENABLE` and `FORCE ROW LEVEL SECURITY` on every table with case data, so even table owners are subject to policies.
- The API opens a transaction per request and sets the authenticated identity with `SET LOCAL` (person and case); policies read it from the transaction settings. No identity, no rows.
- Policies are declared with Drizzle and reviewed as security-critical code.
- CI runs an access-matrix suite against a synthetic database: every role and person combination for every table, asserting both allowed and denied access.

### Field-level encryption

- Bank account numbers and identity document numbers are encrypted per field with envelope encryption: data keys generated and wrapped by AWS KMS in São Paulo (`sa-east-1`), decrypted only in the API when a feature needs them.
- Documents themselves are encrypted on the client (vault ADR, pending) and stored as ciphertext in S3 in `sa-east-1`.

### Backups and deletion

- Initial targets: RPO 15 minutes, RTO 4 hours.
- Neon point-in-time restore, plus a daily encrypted logical backup to S3 in a separate AWS account.
- Restore drills every quarter, with results recorded.
- Deleting a case removes its rows, destroys its keys (crypto-shredding the vault), and deletes related data in workflow runs, object storage, LLM traces and error reports. Point-in-time history keeps deleted rows until the restore window expires; the window is documented and kept as short as the RPO allows.

## Consequences

- A forgotten policy fails closed (no rows), not open.
- Migrations and runtime use different credentials; a compromised API cannot alter the schema or rewrite the audit log.
- Field encryption adds a KMS call path; data keys are cached briefly in memory to keep latency low.

## Sources

- [Neon docs: roles](https://neon.com/docs/manage/roles/) — `neon_superuser` membership and `BYPASSRLS`; SQL-created roles do not inherit it (checked 2026-11-01)
- [Drizzle ORM: row-level security](https://orm.drizzle.team/docs/rls) (checked 2026-11-01)
