# ADR-0003: Application stack

- Status: Accepted
- Date: 2026-11-01 (revised after an independent review the same day)

## Context

- First users: one family, on phones and laptops. Later, many families.
- Platforms, in order: web PWA, Android, iOS and iPadOS, then desktop if a gate passes ([ADR-0005](0005-platform-strategy.md)). The client must build to a static bundle that Capacitor and Tauri can wrap, and all logic must live behind an API.
- The app holds highly sensitive data: identity documents, assets, family relationships. Data at rest and processing should stay in Brazil wherever a choice exists.
- Long-running AI work must not run inside API requests.
- Most code is written by AI agents; quality is enforced by types, tests, the evaluation suite and specialized reviewers.

## Decision

TypeScript end to end, in a pnpm + Turborepo monorepo.

| Layer | Choice |
| --- | --- |
| Language | TypeScript, strict mode |
| Monorepo | pnpm workspaces + Turborepo |
| Client | React + Vite single-page app, installable PWA |
| Routing and server state | TanStack Router, TanStack Query |
| UI | Tailwind CSS with accessible headless primitives (Radix, shadcn/ui pattern) owned in `packages/ui` |
| Forms and validation | React Hook Form + Zod, sharing schemas with the API contract |
| i18n | i18next with ICU message format; `pt-BR` first |
| API | Hono on Node, versioned (`/v1`); contract in Zod, exported as OpenAPI; typed client generated for every platform |
| Hosting | Vercel: static client, and API functions deployed to São Paulo (`gru1`); preview deployment per pull request behind Deployment Protection |
| Background jobs | Vercel Workflows, runs pinned to São Paulo ([ADR-0007](0007-background-jobs.md)) |
| Database | Postgres on Neon, São Paulo (`sa-east-1`); separate projects for production and non-production ([ADR-0008](0008-database-security-and-environments.md)) |
| Data access | Drizzle ORM and migrations; forced row-level security; least-privilege roles created with SQL ([ADR-0008](0008-database-security-and-environments.md)) |
| Vector search | pgvector in the same Postgres; embeddings only for the public knowledge base |
| Auth | Better Auth, self-hosted: passkeys, native passkey APIs on mobile, bearer tokens for native apps ([ADR-0006](0006-auth.md)) |
| Object storage and keys | AWS S3 and AWS KMS in São Paulo (`sa-east-1`): S3 holds client-side ciphertext only; KMS wraps field-encryption keys; accessed through OIDC federation, no static keys |
| Transactional email | Resend |
| AI | Adapters behind ports ([ADR-0004](0004-ai-providers-behind-ports.md)): Vercel AI SDK for LLM calls and structured output (Anthropic Claude by default); TypeSafe Jev for the `Classifier` port when it wins on evaluation; embedding and speech vendors chosen by ADR when those features are built |
| LLM tracing | Langfuse, with a masking function so case content never leaves Brazil; only metadata, scores and redacted text are exported |
| Errors and traces | Sentry (errors and OpenTelemetry traces), personal data scrubbing on; structured JSON logs |
| Rate limiting | Vercel Firewall at the edge, plus limits and per-person AI budgets stored in Postgres |
| Testing | Vitest (unit and integration), Neon branches from a synthetic seed for database tests, Playwright (end to end), the access-matrix suite for row-level security, the synthetic evaluation suite for AI behavior |
| Code quality | ESLint with typescript-eslint strict type-checked rules, Prettier |
| CI and supply chain | GitHub Actions pinned by commit SHA; Renovate; Dependabot alerts and osv-scanner for dependency advisories; CodeQL for code scanning; secret scanning with push protection; gitleaks; SBOM per build; pnpm configured to block dependency install scripts (allow-list only) and to wait a minimum release age before adopting new versions |
| Mobile | Capacitor (Android in Phase 4, iOS and iPadOS in Phase 5) |
| Desktop | Tauri (Phase 6, only if its gate passes) |

The vault's encryption scheme gets its own ADR before the vault is built: standard, reviewed constructions only, no home-made cryptography. Inputs to that ADR: wrapping case keys with keys derived from passkeys through the WebAuthn PRF extension where the provider supports it, with recovery codes as the fallback; not relying on browser storage persistence (Safari can evict site storage for sites not installed to the home screen); and defining how plaintext reaches an authorized document-processing session.

## Alternatives

| Option | Why not |
| --- | --- |
| Next.js with server rendering | Server Actions and server rendering do not travel into native wrappers ([ADR-0005](0005-platform-strategy.md)) |
| .NET API + Angular client | Two languages; the domain package could not be shared between server and clients |
| NestJS instead of Hono | More built-in structure, but heavier; Arca's structure comes from its own layering (domain, ports, adapters) |
| Managed auth (Auth0, Clerk, WorkOS) | Strong option; rejected to keep identity data in our own database in Brazil, with passkeys as the only first-class login |
| Supabase (database + auth + storage) | Fewer vendors, but couples auth, data and storage to one platform and its client patterns |
| Cloudflare R2 for documents | No location in South America; S3 in `sa-east-1` keeps ciphertext in Brazil next to KMS |

## Consequences

- One language and one contract across server, web, mobile and desktop; the domain package is shared and tested once.
- Database, API processing, background jobs, documents and keys stay in São Paulo. Processors outside Brazil receive only what the data-flow register allows ([ARCHITECTURE.md](../ARCHITECTURE.md#data-flows)).
- Hono is minimal; validation, auth, rate limiting and error handling are assembled explicitly and reviewed.

## Sources

- [Neon changelog: São Paulo region generally available](https://neon.com/docs/changelog/2025-02-28) (checked 2026-11-01)
- [Neon docs: roles](https://neon.com/docs/manage/roles/) (checked 2026-11-01)
- [Drizzle ORM: row-level security](https://orm.drizzle.team/docs/rls) (checked 2026-11-01)
- [Vercel docs: Workflows](https://vercel.com/docs/workflow) (checked 2026-11-01)
- [Corbado: WebAuthn PRF support](https://www.corbado.com/blog/passkeys-prf-webauthn) — use as an enhancement with a recovery path (checked 2026-11-01)
