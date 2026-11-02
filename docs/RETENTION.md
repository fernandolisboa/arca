# Retention schedule

As of 2026-11-02. Decided in [ADR-0017](adr/0017-data-lifecycle-and-backups.md). Every row names how the period is enforced. A new kind of data, or a new processor, adds a row here in the same change, together with its entry in the personal-data registry and the data-flow table in [ARCHITECTURE.md](ARCHITECTURE.md#data-flows).

## In our systems

| Data | Kept for | Enforced by |
| --- | --- | --- |
| Case data and account data | While the account exists; after 3 years without a sign-in, an email notice, then deletion 60 days later | Inactivity job (workflow, daily) |
| Account after a deletion request | 7 days locked, then erased | `eraseAccount` workflow |
| Sessions | 3 days idle, 30 days at most | Better Auth expiry plus a daily cleanup job |
| Invites | 7 days, or until accepted | Daily cleanup job |
| Step-up challenges | 2 minutes, single use | Expiry check plus a daily cleanup job |
| Stored step-up assertions | As long as the record they prove (for example, a knowledge-base activation), and erased with the account | Registry |
| Recovery-activated passkey awaiting activation | 24 hours, then active or cancelled | Activation check |
| Recovery links | 30 minutes, single use | Expiry check plus the daily cleanup job |
| Recovery lockout after five wrong codes | 24 hours | Expiry check plus the daily cleanup job |
| Owner-enrollment and invite registration contexts | 30 minutes, single use | Expiry check plus the daily cleanup job |
| Notification channels (push subscriptions) | Until revoked, reported gone by the push service, or the account is deleted | Delivery step and registry |
| Notification messages | 90 days | Daily cleanup job |
| Vault envelopes, recipients and document rows | While the account exists | Registry |
| Rate-limit counters | Their window (minutes) | Daily cleanup job |
| Non-production email outbox | 7 days | Daily cleanup job (non-production only) |
| Audit log | 5 years; records hold identifiers and event codes only | Purge job, specified before the first record turns 5 (2031) |
| Data exports | Not stored; built per request | — |

## At processors

| Processor | Data | Kept for | Enforced by |
| --- | --- | --- | --- |
| Neon | Deleted rows in history | 6 hours (Free plan history window) | Neon project setting |
| AWS S3 (backup account) | Daily backups | 35 days, Object Lock in compliance mode | Bucket lifecycle and Object Lock |
| AWS S3 (application account) | Document ciphertext | While the document exists; noncurrent versions 1 day | Bucket lifecycle rule |
| Vercel | Runtime logs (allow-listed fields only) | 1 day | Vercel Pro policy |
| Vercel Workflows | Run payloads (identifiers only) | Unreadable at run end, deleted within 36 days | `experimental_retention: 0` ([ADR-0009](adr/0009-background-jobs-guarantees.md)) |
| Vercel Workflows | Run metadata (no personal data) | Up to 1 year | Vercel policy |
| Sentry (Germany) | Scrubbed errors and traces | 30 days | Developer plan policy |
| Resend | Recipient address and message metadata (United States) | Resend's log retention for the plan; checked and recorded by the email ticket | Vendor policy |
| Langfuse (EU) | Model-call metadata: no prompt or completion text, no account, case or document IDs, so nothing to erase per person | Set when Langfuse is adopted ([ADR-0016](adr/0016-observability-and-scrubbing.md)) | — |
