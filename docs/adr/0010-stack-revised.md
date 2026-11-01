# ADR-0010: Application stack, revised

- Status: Accepted; preview databases and deploys amended by [ADR-0012](0012-automation-first-setup.md) (Vercel–Neon integration, linked Vercel project, one Neon project)
- Date: 2026-11-01
- Supersedes: [ADR-0003](0003-stack.md)

## Context

- First users: one family, on phones and laptops. Later, many families.
- Platforms, in order: web PWA, Android, iOS and iPadOS, then desktop if a gate passes ([ADR-0005](0005-platform-strategy.md)). The client must build to a static bundle that Capacitor and Tauri can wrap, and all logic must live behind an API.
- The app holds highly sensitive data: identity documents, assets, family relationships. Data at rest and processing should stay in Brazil wherever a choice exists.
- Long-running AI work must not run inside API requests.
- Most code is written by AI agents; quality is enforced by types, tests, the evaluation suite and specialized reviewers.
- The repository is public (decided 2026-11-01). Code scanning, secret scanning with push protection and branch rulesets are available natively at no cost. The repository never holds case data.
- The Workflow SDK needs Nitro to build workflows for a Hono app, and its run data guarantees differ from what ADR-0007 stated ([ADR-0009](0009-background-jobs-guarantees.md)).
- `vercel.app` is on the Public Suffix List: a web preview and an API preview on separate `vercel.app` subdomains are different sites, so session cookies between them are third-party and blocked.

## Changes from ADR-0003

| Area | ADR-0003 | Now | Why |
| --- | --- | --- | --- |
| API build and deploy | Hono on Node | Hono on Node, built and deployed with Nitro (pinned exactly) | The Workflow SDK compiles workflows through Nitro when the app is Hono ([ADR-0009](0009-background-jobs-guarantees.md)) |
| Hosting topology | Static client and API functions (separate projects implied) | One Vercel project, one origin per environment (production and each preview): the API deployment also serves the static web bundle; the API lives under `/v1` on the same origin | Same-origin cookies work in previews; no CORS for the web client; `connect-src 'self'`. `apps/web` still builds to a standalone static bundle for Capacitor and Tauri |
| Background jobs | Runs pinned to São Paulo (ADR-0007) | [ADR-0009](0009-background-jobs-guarantees.md) | ADR-0007's guarantees were not accurate |
| Database tests in CI | Neon branches from a synthetic seed | A Postgres service container in CI, same major version as Neon, pinned by digest; Neon branches from the synthetic seed only for preview deployments | No Neon credentials in test jobs on a public repository; faster, deterministic runs |
| Preview databases | Not specified | Branches of the non-production Neon project, provisioned by our pipeline with the ADR-0008 roles; the Vercel–Neon integration is not used (amended by [ADR-0012](0012-automation-first-setup.md): the integration is used, previews fork from a `development` branch) | The integration injects owner-role connection strings, which ADR-0008 forbids |
| Dependency updates | Renovate | Dependabot version updates with a cooldown equal to pnpm's minimum release age; Renovate only if Dependabot cannot update pnpm catalog entries (checked while scaffolding) | One fewer third-party app with write access to the repository |
| Typed client | Generated for every platform | Derived from the Zod contract, no code generation | Every client is TypeScript; the OpenAPI generators available require TypeScript 5; runtime validation catches drift |
| TypeScript | Strict | TypeScript 7 for builds, 6.0 for lint tooling | Latest compiler; typescript-eslint does not support 7 yet |
| Code review gate | Reviewer subagents run by the authoring session | The same reviewers also run in CI as a required check ([ADR-0011](0011-reviewers-in-ci.md)) | A local run cannot be enforced |

## Decision

TypeScript end to end, in a pnpm + Turborepo monorepo.

| Layer | Choice |
| --- | --- |
| Language | TypeScript, strict mode: the TypeScript 7 native compiler for typechecking and builds; TypeScript 6.0 only where tools need the compiler API (typescript-eslint) |
| Monorepo | pnpm workspaces + Turborepo |
| Client | React + Vite single-page app, installable PWA |
| Routing and server state | TanStack Router, TanStack Query |
| UI | Tailwind CSS with accessible headless primitives (Radix, shadcn/ui pattern) owned in `packages/ui` |
| Forms and validation | React Hook Form + Zod, sharing schemas with the API contract |
| i18n | i18next with ICU message format; `pt-BR` first |
| API | Hono on Node, built and deployed with Nitro; versioned (`/v1`); contract in Zod with `@hono/zod-openapi`, exported as OpenAPI; typed client derived from the same Zod route definitions in `packages/api-contract`, validating responses at runtime, used by every platform |
| Hosting | Vercel Pro team: one project serving the static client and the API functions on one origin per environment, functions in São Paulo (`gru1`); preview deployment per pull request behind Deployment Protection |
| Background jobs | Vercel Workflows 5.x, runs started in `gru1` with zero retention, identifiers-only payloads ([ADR-0009](0009-background-jobs-guarantees.md)) |
| Database | Postgres on Neon, São Paulo (`sa-east-1`); separate projects for production and non-production ([ADR-0008](0008-database-security-and-environments.md)), amended to one project with a `production` branch by [ADR-0012](0012-automation-first-setup.md) |
| Data access | Drizzle ORM and migrations; forced row-level security; least-privilege roles created with SQL ([ADR-0008](0008-database-security-and-environments.md)) |
| Vector search | pgvector in the same Postgres; embeddings only for the public knowledge base |
| Auth | Better Auth, self-hosted: passkeys, native passkey APIs on mobile, bearer tokens for native apps ([ADR-0006](0006-auth.md)) |
| Object storage and keys | AWS S3 and AWS KMS in São Paulo (`sa-east-1`): S3 holds client-side ciphertext only; KMS wraps field-encryption keys; accessed through OIDC federation, no static keys |
| Transactional email | Resend |
| AI | Adapters behind ports ([ADR-0004](0004-ai-providers-behind-ports.md)): Vercel AI SDK for LLM calls and structured output (Anthropic Claude by default); TypeSafe Jev for the `Classifier` port when it wins on evaluation; embedding and speech vendors chosen by ADR when those features are built |
| LLM tracing | Langfuse, with a masking function so case content never leaves Brazil; only metadata, scores and redacted text are exported |
| Errors and traces | Sentry (errors and OpenTelemetry traces), personal data scrubbing on; structured JSON logs |
| Rate limiting | Vercel Firewall at the edge, plus limits and per-person AI budgets stored in Postgres |
| Testing | Vitest (unit and integration), a Postgres service container in CI for database tests, Playwright (end to end), the access-matrix suite for row-level security, the synthetic evaluation suite for AI behavior; preview deployments use Neon branches forked from `development`, which holds the synthetic seed ([ADR-0012](0012-automation-first-setup.md)) |
| Code quality | ESLint with typescript-eslint strict type-checked rules, Prettier |
| CI and supply chain | GitHub Actions pinned by commit SHA, least-privilege permissions; Dependabot version updates with a cooldown (Renovate only as the fallback above); Dependabot alerts and osv-scanner for dependency advisories; CodeQL for code scanning; secret scanning with push protection; gitleaks; SBOM per build; pnpm configured to block dependency install scripts (allow-list only) and to wait a minimum release age before adopting new versions; Turborepo without remote cache until cache artifacts are signed; the reviewer subagents as a required check ([ADR-0011](0011-reviewers-in-ci.md)) |
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
- Nitro is a release candidate as of this date; it is pinned exactly and kept to the build and deploy shell, so it can be replaced without touching routes.
- A client-only change redeploys the API project too; that is accepted for the same-origin benefits.
- **Native clients stay cross-origin.** Capacitor serves the bundle from `https://localhost` (Android) or `capacitor://localhost` (iOS), so native apps call the absolute production origin. They use the ADR-0006 path: a CORS allow-list of the exact Capacitor and Tauri origins without credentialed cookies, bearer tokens in the Keychain or Keystore, and a CSP carried inside the bundle with the API origin in `connect-src`. "No CORS" applies to the web client only.
- One origin is required for previews (the Public Suffix List problem); in production it is a choice, since two subdomains of our own domain would be same-site. Moving the API to its own subdomain later is a configuration change, because the client's base URL is a build setting.
- **Residual risk: the Vercel token is team-scoped.** A token that can create preview deploys can also deploy to production and edit project settings. Deploys therefore go through the REST API with the target asserted, from jobs limited to `main` that run no pull request code ([spec 0001](../specs/0001-foundations-scaffold.md), R9). Revisit if Vercel offers project- or environment-scoped tokens.
- Native builds lag behind deploys, so `/v1` stays backward compatible for older app versions.
- The approved packages and versions for the scaffold are the Versions table in [spec 0001](../specs/0001-foundations-scaffold.md#versions); packages outside it need a supply-chain PASS, and an ADR when they add a new kind of tool or vendor.

## Sources

- [Workflow SDK: getting started with Hono](https://workflow-sdk.dev/docs/getting-started/hono) — Nitro required (checked 2026-11-01)
- [GitHub docs: About secret scanning](https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning) — not available for user-owned private repositories (checked 2026-11-01)
- [pnpm settings](https://pnpm.io/settings) — minimum release age, trust policy, build allow-list (checked 2026-11-01)
- [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat) — lists `vercel.app` (checked 2026-11-01)
- [Vercel docs: supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) — 26.x is the default (checked 2026-11-01)
- [Neon changelog: São Paulo region generally available](https://neon.com/docs/changelog/2025-02-28) (checked 2026-11-01)
- [Neon docs: roles](https://neon.com/docs/manage/roles/) (checked 2026-11-01)
- [Drizzle ORM: row-level security](https://orm.drizzle.team/docs/rls) (checked 2026-11-01)
- [Vercel docs: Workflows](https://vercel.com/docs/workflow) (checked 2026-11-01)
- [Corbado: WebAuthn PRF support](https://www.corbado.com/blog/passkeys-prf-webauthn) — use as an enhancement with a recovery path (checked 2026-11-01)
