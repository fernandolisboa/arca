import { AsyncLocalStorage } from 'node:async_hooks';
import {
  PasskeyCreationOptions,
  type RegistrationOptionsRequest,
  type RegistrationVerifyRequest,
} from '@arca/api-contract/routes';
import type { Database, Transaction } from '@arca/db';
import { passkeyCapability, registrationContext, setup } from '@arca/db/enrollment-schema';
import type {
  RegistrationResponseJSON,
  VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import { APIError, isAPIError } from 'better-auth/api';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';
import type { Logger } from '../logger.js';
import { accounts, type Auth } from './auth.js';
import { sha256, type OwnerCode } from './enrollment.js';

/** What the registration routes hand the passkey plugin for one ceremony. */
interface Ceremony {
  readonly tokenHash: Buffer;
  readonly code: string | undefined;
  /** Set once the attestation is verified and its account created. */
  registered?: { readonly credentialId: string; readonly prfEnabled: boolean };
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

    /** Runs one call of the plugin for this link and code. */
    within: <T>(tokenHash: Buffer, code: string | undefined, run: () => Promise<T>) =>
      ceremonies.run({ tokenHash, code }, run),

    /** Only a live context names the account to create; there is no other way to sign up. */
    resolveUser: async ({ context }: { context?: string | null | undefined }) => {
      const ceremony = ceremonies.getStore();
      if (ceremony === undefined || typeof context !== 'string') throw refused();
      const [found] = await db
        .select({ id: registrationContext.id, email: registrationContext.email })
        .from(registrationContext)
        .where(live(ceremony.tokenHash, context));
      if (found === undefined) throw refused();
      // The context stands in for the account until afterVerification creates it.
      return { id: found.id, name: found.email, displayName: found.email };
    },

    /**
     * In the ceremony's transaction: spends the context, then for the owner records the code as
     * used (its primary key makes a concurrent enrollment conflict), re-checks that no account
     * exists and creates the confirmed account.
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
      const [claimed] = await tx
        .delete(registrationContext)
        .where(live(ceremony.tokenHash, context))
        .returning({ email: registrationContext.email });
      const codeHash = ownerCode(ceremony.code);
      if (claimed === undefined || codeHash === null) throw refused();
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
      ceremony.registered = {
        credentialId: info.credential.id,
        prfEnabled: prfEnabled(clientData),
      };
      return { userId: accountId };
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
    liveContext: async (tokenHash: Buffer) => {
      const [found] = await db
        .select({ id: registrationContext.id, kind: registrationContext.kind })
        .from(registrationContext)
        .where(live(tokenHash));
      return found;
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

export function registration(
  auth: Auth,
  hooks: RegistrationHooks,
  ownerCode: OwnerCode,
  logger: Logger,
): Registration {
  return {
    // The code is checked before the ceremony too, so a typo costs no passkey on the device.
    options: async (headers, { token, code }) => {
      const tokenHash = sha256(token);
      const context = await hooks.liveContext(tokenHash);
      if (context === undefined) return { ok: false, reason: 'not_found' };
      if (context.kind === 'owner' && ownerCode(code) === null) {
        return { ok: false, reason: 'invalid_code' };
      }
      const { headers: answered, response } = await hooks.within(tokenHash, code, () =>
        auth.api.generatePasskeyRegistrationOptions({
          headers,
          query: { context: context.id },
          returnHeaders: true,
        }),
      );
      // SimpleWebAuthn adds credProps, which Arca never reads; only the empty PRF request stays.
      const body = PasskeyCreationOptions.parse({ ...response, extensions: { prf: {} } });
      return { ok: true, body, setCookies: answered.getSetCookie() };
    },
    verify: async (headers, { token, code, response }) => {
      try {
        const { headers: answered } = await hooks.within(sha256(token), code, () =>
          auth.api.verifyPasskeyRegistration({
            headers,
            body: { response, createSession: true },
            returnHeaders: true,
          }),
        );
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
