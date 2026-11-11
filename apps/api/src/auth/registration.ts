import { AsyncLocalStorage } from 'node:async_hooks';
import {
  PasskeyCreationOptions,
  type RegistrationOptionsRequest,
  type RegistrationVerifyRequest,
} from '@arca/api-contract/routes';
import type { Database, Transaction } from '@arca/db';
import { invite, passkeyCapability, registrationContext, setup } from '@arca/db/enrollment-schema';
import type {
  RegistrationResponseJSON,
  VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import { APIError, isAPIError } from 'better-auth/api';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';
import type { Logger } from '@arca/telemetry';
import { attestsWithoutCertificates } from './attestation.js';
import { accounts, type Auth } from './auth.js';
import { sha256, type OwnerCode } from './enrollment.js';
import { liveInvite } from './invites.js';

/** What the registration routes hand the passkey plugin for one ceremony. */
interface Ceremony {
  readonly tokenHash: Buffer;
  readonly code: string | undefined;
  /** Set once the attestation is verified and its account created. */
  registered?: {
    readonly credentialId: string;
    readonly prfEnabled: boolean;
    /** The invite the registration accepted, whose inviter is told once it commits. */
    readonly inviteId?: string;
  };
}

/** What a link opens: the owner's enrollment or an invite (spec 0003, R2). */
export interface LinkContext {
  readonly id: string;
  readonly kind: 'owner' | 'invite';
}

/** SimpleWebAuthn's types predate PRF; the contract lets only `prf.enabled` through. */
const prfEnabled = (response: RegistrationResponseJSON) =>
  (response.clientExtensionResults as { prf?: { enabled?: unknown } }).prf?.enabled === true;

/** Every refusal alike, so a caller learns nothing about which check failed. */
const refused = () => new APIError('FORBIDDEN', { code: 'REGISTRATION_REFUSED' });

const live = (tokenHash: Buffer, contextId?: string) =>
  and(
    contextId === undefined ? undefined : eq(registrationContext.id, contextId),
    eq(registrationContext.tokenHash, tokenHash),
    gt(registrationContext.expiresAt, sql`now()`),
  );

export interface RegistrationSettings {
  /** A database on the app_auth pool. */
  readonly db: Database;
  readonly audit: AuditLog;
  readonly ownerCode: OwnerCode;
}

/**
 * Passkey-first registration through the passkey plugin (spec 0003, R2 and R3): the plugin
 * verifies the attestation and stores the passkey and the session; Arca's callbacks claim the
 * registration context and create the account. Better Auth's adapter runs the ceremony in one
 * transaction, which the callbacks join, so a failure anywhere leaves no account behind. This
 * relies on the Drizzle adapter (1.7.14) opening that transaction with `db.transaction`; if an
 * upgrade stops doing so, the callbacks find no transaction and refuse every registration.
 */
export function registrationHooks({ db, audit, ownerCode }: RegistrationSettings) {
  const ceremonies = new AsyncLocalStorage<Ceremony>();
  const transactions = new AsyncLocalStorage<Transaction>();

  const liveContext = async (tokenHash: Buffer) => {
    const [owner] = await db
      .select({ id: registrationContext.id, email: registrationContext.email })
      .from(registrationContext)
      .where(live(tokenHash));
    if (owner !== undefined) return { ...owner, kind: 'owner' as const };
    const [invited] = await db
      .select({ id: invite.id, email: invite.email })
      .from(invite)
      .where(liveInvite(tokenHash));
    // An address that already has an account cannot register again, so its link opens nothing
    // and the device stores no passkey for it. Sending the invite told the inviter nothing.
    if (invited === undefined || (await accounts.withEmail(db, invited.email))) return undefined;
    return { ...invited, kind: 'invite' as const };
  };

  /**
   * Spends the owner context, records the code as used (its primary key makes a concurrent
   * enrollment conflict), re-checks that no account exists and creates the confirmed account.
   * Undefined when the context is not the owner's.
   */
  const ownerAccount = async (tx: Transaction, ceremony: Ceremony, context: string) => {
    const [claimed] = await tx
      .delete(registrationContext)
      .where(live(ceremony.tokenHash, context))
      .returning({ email: registrationContext.email });
    if (claimed === undefined) return undefined;
    const codeHash = ownerCode(ceremony.code);
    if (codeHash === null) throw refused();
    const [spent] = await tx
      .insert(setup)
      .values({ codeHash })
      .onConflictDoNothing()
      .returning({ codeHash: setup.codeHash });
    if (spent === undefined || (await accounts.anyExists(tx))) throw refused();
    const accountId = await accounts.createConfirmed(tx, claimed.email);
    if (accountId === undefined) throw refused();
    // Any other owner link, such as one from a racing request, can no longer register.
    await tx.delete(registrationContext).where(eq(registrationContext.kind, 'owner'));
    // Recorded before the commit, like every security event: a failed write fails the ceremony.
    await audit.record({
      code: 'owner_enrolled',
      subjectAccountId: accountId,
      actorAccountId: accountId,
      details: {},
    });
    return { accountId, inviteId: undefined };
  };

  /**
   * Creates the invited account, unconfirmed, and marks the invite accepted by it; the update's
   * conditions make it single use under concurrency. Undefined when the context is no live invite.
   */
  const invitedAccount = async (tx: Transaction, ceremony: Ceremony, context: string) => {
    const [found] = await tx
      .select({ email: invite.email, inviterId: invite.inviterId })
      .from(invite)
      .where(liveInvite(ceremony.tokenHash, context));
    if (found === undefined) return undefined;
    const accountId = await accounts.createUnconfirmed(tx, found.email);
    if (accountId === undefined) throw refused();
    const [accepted] = await tx
      .update(invite)
      .set({ acceptedAt: sql`now()`, acceptedAccountId: accountId })
      .where(liveInvite(ceremony.tokenHash, context))
      .returning({ id: invite.id });
    if (accepted === undefined) throw refused();
    // The inviter's trail shows the link was used, and outlives a declined account.
    await audit.record({
      code: 'invite_accepted',
      subjectAccountId: found.inviterId,
      actorAccountId: accountId,
      details: { inviteId: accepted.id },
    });
    return { accountId, inviteId: accepted.id };
  };

  return {
    /** The database Better Auth's adapter gets: its transactions are shared with the callbacks. */
    adapterDb: new Proxy(db, {
      get(target, key) {
        if (key !== 'transaction') return Reflect.get(target, key, target) as unknown;
        const transaction: Database['transaction'] = (run, config) =>
          target.transaction((tx) => transactions.run(tx, () => run(tx)), config);
        return transaction;
      },
    }),

    /** Runs one call of the plugin for this ceremony. */
    within: <T>(ceremony: Ceremony, run: () => Promise<T>) => ceremonies.run(ceremony, run),

    /** Only a live context names the account to create; there is no other way to sign up. */
    resolveUser: async ({ context }: { context?: string | null | undefined }) => {
      const ceremony = ceremonies.getStore();
      if (ceremony === undefined || typeof context !== 'string') throw refused();
      const found = await liveContext(ceremony.tokenHash);
      if (found?.id !== context) throw refused();
      // The context stands in for the account until afterVerification creates it.
      return { id: found.id, name: found.email, displayName: found.email };
    },

    /**
     * In the ceremony's transaction: spends the owner context or the invite and creates the
     * account (see ownerAccount and invitedAccount).
     */
    afterVerification: async ({
      verification,
      user: pending,
      clientData,
      context,
    }: {
      verification: VerifiedRegistrationResponse;
      user: { id: string };
      clientData: RegistrationResponseJSON;
      context?: string | null | undefined;
    }) => {
      const ceremony = ceremonies.getStore();
      const tx = transactions.getStore();
      const info = verification.registrationInfo;
      // A session's own user would stand in place of the context; only a context may register.
      if (
        ceremony === undefined ||
        tx === undefined ||
        typeof context !== 'string' ||
        pending.id !== context ||
        info?.userVerified !== true
      ) {
        throw refused();
      }
      const created =
        (await ownerAccount(tx, ceremony, context)) ??
        (await invitedAccount(tx, ceremony, context));
      if (created === undefined) throw refused();
      ceremony.registered = {
        credentialId: info.credential.id,
        prfEnabled: prfEnabled(clientData),
        ...(created.inviteId === undefined ? {} : { inviteId: created.inviteId }),
      };
      return { userId: created.accountId };
    },

    /**
     * The session a registration creates is signed in by the passkey just stored, whose
     * capabilities are recorded here because the plugin inserts the passkey only after
     * afterVerification; both stay in the ceremony's transaction.
     */
    registeredPasskey: async (): Promise<string | undefined> => {
      const registered = ceremonies.getStore()?.registered;
      const tx = transactions.getStore();
      if (registered === undefined || tx === undefined) return undefined;
      await tx
        .insert(passkeyCapability)
        .values({ credentialID: registered.credentialId, prfEnabled: registered.prfEnabled });
      return registered.credentialId;
    },

    /** The context a link token opens, while it can still register. */
    liveContext: async (tokenHash: Buffer): Promise<LinkContext | undefined> => {
      const found = await liveContext(tokenHash);
      return found === undefined ? undefined : { id: found.id, kind: found.kind };
    },
  };
}

export type RegistrationHooks = ReturnType<typeof registrationHooks>;

export type RegistrationOutcome<Body> =
  | { readonly ok: true; readonly body: Body; readonly setCookies: readonly string[] }
  | { readonly ok: false; readonly reason: 'not_found' | 'invalid_code' | 'refused' };

export interface Registration {
  readonly options: (
    headers: Headers,
    request: RegistrationOptionsRequest,
  ) => Promise<RegistrationOutcome<PasskeyCreationOptions>>;
  readonly verify: (
    headers: Headers,
    request: RegistrationVerifyRequest,
  ) => Promise<RegistrationOutcome<Record<string, never>>>;
}

/** The request's cookies without the ones that carry a session (a cache may span chunks). */
function withoutSession(headers: Headers, sessionCookies: readonly string[]): Headers {
  const kept = new Headers(headers);
  const cookies = (headers.get('cookie') ?? '')
    .split(';')
    .map((pair) => pair.trim())
    .filter(
      (pair) =>
        pair !== '' &&
        !sessionCookies.some((name) => pair.startsWith(`${name}=`) || pair.startsWith(`${name}.`)),
    );
  if (cookies.length === 0) kept.delete('cookie');
  else kept.set('cookie', cookies.join('; '));
  return kept;
}

export function registration(
  auth: Auth,
  hooks: RegistrationHooks,
  ownerCode: OwnerCode,
  logger: Logger,
  /** Runs after a registration from an invite commits; it must not throw. */
  inviteAccepted: (inviteId: string) => Promise<void>,
): Registration {
  // A session the plugin sees would stand in for the link's context (its own account would get
  // the passkey, which afterVerification then refuses), so it never sees one. A live session is
  // answered 409 before this; this covers one that Arca no longer counts, or one signed in from
  // another tab between options and verify.
  const sessionCookies = auth.$context.then(({ authCookies }) =>
    Object.values(authCookies).map(({ name }) => name),
  );
  const pluginHeaders = async (headers: Headers) => withoutSession(headers, await sessionCookies);
  return {
    // The code is checked before the ceremony too, so a typo costs no passkey on the device.
    options: async (headers, { token, code }) => {
      const tokenHash = sha256(token);
      const context = await hooks.liveContext(tokenHash);
      if (context === undefined) return { ok: false, reason: 'not_found' };
      if (context.kind === 'owner' && ownerCode(code) === null) {
        return { ok: false, reason: 'invalid_code' };
      }
      const plugin = await pluginHeaders(headers);
      const { headers: answered, response } = await hooks.within({ tokenHash, code }, () =>
        auth.api.generatePasskeyRegistrationOptions({
          headers: plugin,
          query: { context: context.id },
          returnHeaders: true,
        }),
      );
      // SimpleWebAuthn adds credProps, which Arca never reads; only the empty PRF request stays.
      const body = PasskeyCreationOptions.parse({ ...response, extensions: { prf: {} } });
      return { ok: true, body, setCookies: answered.getSetCookie() };
    },
    verify: async (headers, { token, code, response }) => {
      // The plugin calls the verifier itself, so the attestation is checked before it runs.
      if (!attestsWithoutCertificates(response.response.attestationObject)) {
        logger.info({ errorName: 'RegistrationRefused' });
        return { ok: false, reason: 'refused' };
      }
      const ceremony: Parameters<RegistrationHooks['within']>[0] = {
        tokenHash: sha256(token),
        code,
      };
      try {
        const plugin = await pluginHeaders(headers);
        const { headers: answered } = await hooks.within(ceremony, () =>
          auth.api.verifyPasskeyRegistration({
            headers: plugin,
            body: { response, createSession: true },
            returnHeaders: true,
          }),
        );
        const inviteId = ceremony.registered?.inviteId;
        if (inviteId !== undefined) await inviteAccepted(inviteId);
        return { ok: true, body: {}, setCookies: answered.getSetCookie() };
      } catch (error) {
        // The plugin turns every failure inside it into an APIError: a 500 for an attestation
        // that fails verification and for a database fault alike, so all answer as a refusal and
        // a 500 is logged as an error.
        if (!isAPIError(error)) throw error;
        logger[error.statusCode >= 500 ? 'error' : 'info']({ errorName: 'RegistrationRefused' });
        return { ok: false, reason: 'refused' };
      }
    },
  };
}
