# Retention schedule

As of 2026-11-04. Decided in [ADR-0017](adr/0017-data-lifecycle-and-backups.md). Every row names how the period is enforced. A new kind of data, or a new processor, adds a row here in the same change, together with its entry in the personal-data registry and the data-flow table in [ARCHITECTURE.md](ARCHITECTURE.md#data-flows).

## In our systems

| Data | Kept for | Enforced by |
| --- | --- | --- |
| Case data and account data | While the account exists; after 3 years without a sign-in, an email notice, then deletion 60 days later | Inactivity job (workflow, daily) |
| Account after a deletion request | 7 days locked, then erased | `eraseAccount` workflow |
| Sessions | 3 days idle, 30 days at most | Better Auth expiry (slid only while the session is under 30 days old, so it ends by day 33 at the latest) plus a daily cleanup job; never backed up |
| Pending document uploads (never confirmed) | 24 hours, with their objects | Daily cleanup job |
| Browser and system families seen per passkey (`auth.passkey_client`) | While the passkey exists | Deleted with the passkey (foreign key cascade); erased with the account; backed up |
| Unconfirmed invited accounts | Erased when the inviter declines them, or when `confirmed_at` is still empty 30 days after creation | Daily cleanup job starts `eraseAccount` |
| Account links (inviter and invitee) | While both accounts exist | Registry |
| Step-up challenges (`auth.step_up_challenge`) | 2 minutes, single use | Expiry check; deleted when verified; expired ones are swept on every new challenge; erased with the session or account; never backed up |
| Stored step-up assertions (`auth.step_up`) | As long as the record they prove (for example, an account deletion request), and erased with the account; one never spent is deleted after 15 minutes, when no action can spend it; a spent one stays with the account until the first consumer that keeps its own copy (such as the deletion request, spec 0004) lets spent ones be swept | Swept on every new challenge; cascade on account erasure; registry; backed up |
| Waits of added and recovery passkeys (`auth.passkey_activation`, a credential ID, a time and whether a recovery made it) | 24 hours, then active, or cancelled | Deleted at the account's first signed-in request after the wait, or with the passkey (foreign key cascade); erased with the account; backed up, so a restore keeps the wait |
| Add-passkey challenges (`auth.passkey_challenge`) | 2 minutes, single use | Expiry check; deleted by the attempt that spends it; expired ones are swept on every new challenge; erased with the session or account; never backed up |
| Recovery links (`auth.recovery_link`: a token hash, an account ID, times and a 2-minute challenge) | 30 minutes, single use | Deleted by the passkey it registers, by a lockout, by the account's next link; expired ones are swept on every new link; erased with the account; never backed up |
| Recovery lockouts (`auth.recovery_lock`: an account ID, a count of wrong codes and a lock end) | While the account exists; the right code resets the count, and a lock lasts 24 hours | Cascade on account erasure; backed up |
| Owner-enrollment registration contexts (`auth.registration_context`, with the address the link went to) | 30 minutes, single use | Expiry check; deleted when a registration spends it; a new owner link deletes earlier ones and expired ones; the daily cleanup job; never backed up |
| Invites (`auth.invite`, with the invitee's address and the token's hash) | 48 hours unaccepted; once accepted, until the inviter confirms or declines the account, or 30 days, then with the accounts | Expiry check; an expired invite never accepted is deleted, with an `invite expired` event, whenever any account sends an invite, and by the daily cleanup job; a new invite to the same address replaces the open one; erased with the inviter's or the invitee's account; never backed up. Until the daily jobs exist (spec 0004 R10), expired invites wait for the next invite anyone sends, and an accepted, undecided one stays until the decision |
| Passkey ceremony state (`auth.verification`: a challenge with a registration context's ID and address, or a signed-in account's ID) | 5 minutes, single use | Expiry check; deleted by the ceremony that spends it; expired ones are swept whenever a new ceremony starts and by account erasure; never backed up |
| Spent enrollment codes (`auth.setup`, a hash, no personal data) | Forever, so an emptied user table never revives a code | Never erased; on the registry's unowned list, with no personal data; backed up |
| Account recovery code (`auth.recovery_code`, a salted hash) | While the account exists; replaced by each new kit, and one a recovery issued lapses with its link unless the passkey registers; cancelling a recovery deletes it | Replaced in place; cascade on account erasure; backed up |
| What a passkey's authenticator reported at registration (`auth.passkey_capability`) | While the passkey exists | Deleted with the passkey (foreign key cascade); erased with the account; backed up |
| Notification channels (push subscriptions) | Until revoked, reported gone by the push service, or the account is deleted | Delivery step and registry |
| Notification messages and their deliveries | 90 days | Daily cleanup job |
| Vault envelopes, recipients, sharing state and document rows | While the account exists; a rotated identity's envelopes until every sharing owner re-encrypts, or 90 days | Registry; daily cleanup job for rotated envelopes |
| Rate-limit counters (`auth.rate_limit`, HMAC keys only) | Their window (up to an hour; a day for invites) | A hit after the window starts a new one; the daily `/internal/cron/rate-limit-sweep` deletes ended windows in production; previews run no cron, so their ended windows stay until the next hit on the same key, bounded by the routes and addresses that reached them; never backed up |
| Non-production email outbox (`auth.outbox`) | 7 days | Each outbox write deletes expired rows, and the preview page shows only unexpired ones; a daily cleanup job joins with the other cleanups |
| Audit log | 5 years; records hold identifiers and event codes only | Purge job, specified before the first record turns 5 (2031) |
| Data exports | Not stored; built per request | — |

## At processors

| Processor | Data | Kept for | Enforced by |
| --- | --- | --- | --- |
| Neon | Deleted rows in history | 6 hours (Free plan history window) | Neon project setting |
| Neon | Incident evidence branches (`incident-YYYYMMDD`) and the backup branch a point-in-time restore leaves: full copies of the database | Until the investigation and any ANPD process close | Deleted by the owner as the [incident runbook](runbooks/incident-response.md#take-an-evidence-branch) says; their app roles are set to `NOLOGIN` when taken |
| AWS S3 (backup account) | Daily backups and erasure tombstones | 35 days under Object Lock in compliance mode, removed by day 36 | Bucket lifecycle (current and noncurrent versions) and Object Lock |
| AWS S3 (backup account) | Replica of document ciphertext, including replaced versions | While the document exists; a replaced or deleted version 35 days more | Replication with delete markers; noncurrent-version lifecycle |
| AWS S3 (application account) | Document ciphertext | While the document exists; noncurrent versions 1 day | Bucket lifecycle rule |
| Vercel | Runtime logs (allow-listed fields only) | 1 day | Vercel Pro policy |
| Vercel Workflows | Run payloads (identifiers only) | Unreadable at run end, deleted within 36 days | `experimental_retention: 0` ([ADR-0009](adr/0009-background-jobs-guarantees.md)) |
| Vercel Workflows | Run metadata (no personal data) | Up to 1 year | Vercel policy |
| Sentry (Germany) | Scrubbed errors and traces | 30 days | Developer plan policy |
| AWS CloudWatch Logs (backup account, São Paulo) | Restore job status: table names, counts and error codes, never row contents | 35 days | Log group retention in the template |
| Resend | Recipient address, message content and metadata (United States) | 30 days on the Free, Pro and Scale plans ([Resend pricing](https://resend.com/pricing), checked 2026-11-04) | Vendor policy |
| Langfuse (EU) | Model-call metadata: no prompt or completion text, no account, case or document IDs, so nothing to erase per person | Set when Langfuse is adopted ([ADR-0016](adr/0016-observability-and-scrubbing.md)) | — |
