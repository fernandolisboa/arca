import { randomBytes } from 'node:crypto';
import type {
  PasskeyAssertion,
  StepUpOptionsRequest,
  StepUpOptionsResponse,
  StepUpPurpose,
} from '@arca/api-contract/routes';
import type { Database, Transaction } from '@arca/db';
import { stepUp, stepUpChallenge as challenge } from '@arca/db/step-up-schema';
import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { and, eq, gt, isNull, lt, lte, sql } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';
import type { Logger } from '@arca/telemetry';
import type { CredentialStore } from './auth.js';
import type { SignedIn } from './service.js';
import { stepUpChallenge, subjectHash, type CanonicalAction } from './step-up-encoding.js';
import type { StoredAssertion } from './step-up-reverify.js';

export type ActionPurpose = Exclude<StepUpPurpose, 'vault_unlock'>;

/**
 * Ends what a revoked passkey approved and nothing spent yet, an open `vault_unlock` window
 * included, in whichever session it was verified; spent ones stay for re-verification (R4, R5).
 */
export async function forgetUnspent(
  tx: Transaction,
  accountId: string,
  credentialId: string,
): Promise<void> {
  await tx
    .delete(stepUp)
    .where(
      and(
        eq(stepUp.accountId, accountId),
        eq(stepUp.credentialId, credentialId),
        isNull(stepUp.consumedAt),
      ),
    );
}

export interface StepUpService {
  readonly options: (
    signedIn: SignedIn,
    request: StepUpOptionsRequest,
  ) => Promise<StepUpOptionsResponse>;
  /** False for every refusal alike, so a caller learns nothing about why. */
  readonly verify: (
    signedIn: SignedIn,
    challengeId: string,
    response: PasskeyAssertion,
  ) => Promise<boolean>;
  /**
   * `requireStepUp` (spec 0003, R5): spends the one step-up this session verified within 5 minutes
   * for this purpose and this action, recomputed by the route from the request it serves.
   */
  readonly consume: (
    signedIn: SignedIn,
    purpose: ActionPurpose,
    action: CanonicalAction,
  ) => Promise<boolean>;
  /** Whether this session verified a `vault_unlock` within 15 minutes; never consumed. */
  readonly vaultUnlocked: (signedIn: SignedIn) => Promise<boolean>;
}

/** For a consumer that keeps its own copy of the assertion it spends (spec 0007, R7). */
export interface StepUpSpender {
  /**
   * `consume`, handing `record` the spent assertion and its passkey's public key inside the
   * transaction that spends it, so the step-up is spent if and only if `record` commits. False,
   * with nothing changed, when there is nothing to spend.
   */
  readonly spend: (
    signedIn: SignedIn,
    purpose: ActionPurpose,
    action: CanonicalAction,
    record: (tx: Transaction, spent: SpentStepUp) => Promise<void>,
  ) => Promise<boolean>;
}

class NothingSpent extends Error {}

/** A spent step-up: its ID, its stored assertion and the public key it verifies against. */
export interface SpentStepUp extends StoredAssertion {
  readonly id: string;
  /** COSE, as the passkey was stored when the step-up was spent. */
  readonly publicKey: Uint8Array<ArrayBuffer>;
}

export interface StepUpSettings {
  /** A database on the app_auth pool. */
  readonly db: Database;
  readonly credentials: CredentialStore;
  readonly audit: AuditLog;
  /** The environment's own origin; its host is the relying-party ID (spec 0003, R9). */
  readonly origin: string;
  readonly logger: Logger;
}

const challengeTimeoutMs = 2 * 60 * 1000;
const empty = new Uint8Array(0);

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

/** The contract keeps transports open-ended; the browser ignores the ones it does not know. */
const asTransports = (transports: readonly string[]) =>
  transports as AuthenticatorTransportFuture[];

export function createStepUp({
  db,
  credentials,
  audit,
  origin,
  logger,
}: StepUpSettings): StepUpService & StepUpSpender {
  const rpId = new URL(origin).hostname;

  /** The one step-up this session verified within 5 minutes for this purpose and action. */
  const spendable = (
    { accountId, sessionId }: SignedIn,
    purpose: ActionPurpose,
    action: CanonicalAction,
  ) =>
    and(
      eq(stepUp.accountId, accountId),
      eq(stepUp.sessionId, sessionId),
      eq(stepUp.purpose, purpose),
      eq(stepUp.subjectHash, Buffer.from(subjectHash(action))),
      isNull(stepUp.consumedAt),
      gt(stepUp.verifiedAt, sql`now() - interval '5 minutes'`),
    );

  /**
   * Expired challenges, and step-ups never spent once no action can spend them, are deleted on
   * every new challenge, so both tables stay bounded. A failed sweep never fails the ceremony.
   */
  async function sweep() {
    try {
      await db.delete(challenge).where(lte(challenge.expiresAt, sql`now()`));
      await db
        .delete(stepUp)
        .where(
          and(isNull(stepUp.consumedAt), lt(stepUp.verifiedAt, sql`now() - interval '15 minutes'`)),
        );
    } catch (error) {
      logger.error({
        errorName: `StepUpSweep:${error instanceof Error ? error.name : 'NonErrorThrown'}`,
      });
    }
  }

  return {
    options: async ({ accountId, sessionId }, request) => {
      await sweep();
      const subject =
        request.purpose === 'vault_unlock'
          ? empty
          : subjectHash({
              ...request.target,
              nonce: new Uint8Array(Buffer.from(request.target.nonce, 'base64url')),
            });
      const nonce = new Uint8Array(randomBytes(32));
      const [issued] = await db
        .insert(challenge)
        .values({
          accountId,
          sessionId,
          purpose: request.purpose,
          subjectHash: Buffer.from(subject),
          nonce: Buffer.from(nonce),
        })
        .returning({ id: challenge.id });
      if (issued === undefined) throw new Error('the challenge was not stored');
      const allowed = await credentials.activeOf(accountId);
      return {
        challengeId: issued.id,
        options: {
          challenge: base64url(stepUpChallenge(request.purpose, subject, nonce)),
          timeout: challengeTimeoutMs,
          rpId,
          allowCredentials: allowed.map(({ credentialId, transports }) => ({
            id: credentialId,
            type: 'public-key' as const,
            transports: [...transports],
          })),
          userVerification: 'required',
        },
      };
    },

    verify: async ({ accountId, sessionId }, challengeId, response) => {
      // Consumed before verification, so a challenge is spent by its first attempt, good or not.
      const [issued] = await db
        .delete(challenge)
        .where(
          and(
            eq(challenge.id, challengeId),
            eq(challenge.sessionId, sessionId),
            eq(challenge.accountId, accountId),
          ),
        )
        .returning({
          purpose: challenge.purpose,
          subjectHash: challenge.subjectHash,
          nonce: challenge.nonce,
          live: sql<boolean>`${challenge.expiresAt} > now()`,
        });
      if (issued?.live !== true) return false;
      const credential = await credentials.active(accountId, response.id);
      if (credential === null) return false;
      const purpose = issued.purpose as StepUpPurpose;
      let newCounter: number;
      try {
        const { verified, authenticationInfo } = await verifyAuthenticationResponse({
          response: response as AuthenticationResponseJSON,
          expectedChallenge: base64url(stepUpChallenge(purpose, issued.subjectHash, issued.nonce)),
          expectedOrigin: origin,
          expectedRPID: rpId,
          expectedType: 'webauthn.get',
          credential: {
            id: credential.credentialId,
            publicKey: credential.publicKey,
            counter: credential.counter,
            transports: asTransports(credential.transports),
          },
          requireUserVerification: true,
        });
        if (!verified) return false;
        newCounter = authenticationInfo.newCounter;
      } catch {
        return false;
      }
      return credentials.advanceCounter(
        accountId,
        credential.credentialId,
        newCounter,
        async (tx) => {
          // Recorded first: a step-up no event records must never be stored, let alone spent (R7).
          await audit.record({
            code: 'step_up_verified',
            subjectAccountId: accountId,
            actorAccountId: accountId,
            details: { purpose },
          });
          await tx.insert(stepUp).values({
            accountId,
            sessionId,
            credentialId: credential.credentialId,
            purpose,
            subjectHash: issued.subjectHash,
            nonce: issued.nonce,
            authenticatorData: Buffer.from(response.response.authenticatorData, 'base64url'),
            clientDataJson: Buffer.from(response.response.clientDataJSON, 'base64url'),
            signature: Buffer.from(response.response.signature, 'base64url'),
          });
        },
      );
    },

    consume: async (signedIn, purpose, action) => {
      const spent = await db
        .update(stepUp)
        .set({ consumedAt: sql`now()` })
        .where(spendable(signedIn, purpose, action))
        .returning({ id: stepUp.id });
      return spent.length > 0;
    },

    spend: async (signedIn, purpose, action, record) => {
      try {
        await db.transaction(async (tx) => {
          const [spent] = await tx
            .update(stepUp)
            .set({ consumedAt: sql`now()` })
            .where(spendable(signedIn, purpose, action))
            .returning({
              id: stepUp.id,
              credentialId: stepUp.credentialId,
              nonce: stepUp.nonce,
              authenticatorData: stepUp.authenticatorData,
              clientDataJson: stepUp.clientDataJson,
              signature: stepUp.signature,
            });
          if (spent === undefined) throw new NothingSpent();
          // Revoking the passkey deletes its unspent step-ups in the revoking transaction, so a
          // step-up this update found still has its passkey; if not, nothing is spent.
          const credential = await credentials.activeIn(tx, signedIn.accountId, spent.credentialId);
          if (credential === null) throw new NothingSpent();
          await record(tx, { ...spent, publicKey: credential.publicKey });
        });
        return true;
      } catch (error) {
        if (error instanceof NothingSpent) return false;
        throw error;
      }
    },

    vaultUnlocked: async ({ accountId, sessionId }) => {
      const [open] = await db
        .select({ id: stepUp.id })
        .from(stepUp)
        .where(
          and(
            eq(stepUp.accountId, accountId),
            eq(stepUp.sessionId, sessionId),
            eq(stepUp.purpose, 'vault_unlock'),
            gt(stepUp.verifiedAt, sql`now() - interval '15 minutes'`),
          ),
        )
        .limit(1);
      return open !== undefined;
    },
  };
}
