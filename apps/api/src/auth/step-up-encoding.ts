import { createHash } from 'node:crypto';
import type { StepUpPurpose } from '@arca/api-contract/routes';

/** What a guarded route recomputes from the request it serves (spec 0003, R5). */
export interface CanonicalAction {
  readonly action: string;
  readonly targets: readonly string[];
  readonly fields?: Readonly<Record<string, string>> | undefined;
  /** The client's 16-byte nonce, sent with the options and again with the action. */
  readonly nonce: Uint8Array;
}

const encoder = new TextEncoder();

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

/** Each part prefixed with its length as 4 bytes big-endian, so no two inputs share an encoding. */
function lengthPrefixed(parts: readonly Uint8Array[]): Uint8Array {
  const sha = createHash('sha256');
  for (const part of parts) sha.update(uint32(part.length)).update(part);
  return new Uint8Array(sha.digest());
}

const text = (value: string) => encoder.encode(value);

/**
 * The 32-byte subject hash of a canonical action: the tag, the operation ID, the target count and
 * each target in order, the field count and each field as key then value in key order, then the
 * nonce.
 */
export function subjectHash({ action, targets, fields = {}, nonce }: CanonicalAction): Uint8Array {
  const entries = Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return lengthPrefixed([
    text('arca-step-up-action/v1'),
    text(action),
    uint32(targets.length),
    ...targets.map(text),
    uint32(entries.length),
    ...entries.flatMap(([key, value]) => [text(key), text(value)]),
    nonce,
  ]);
}

/**
 * The WebAuthn challenge of a step-up (ADR-0015): SHA-256 over the tag, the purpose, the subject
 * hash (empty for `vault_unlock`) and the server's 32-byte nonce, each length-prefixed.
 */
export function stepUpChallenge(
  purpose: StepUpPurpose,
  subject: Uint8Array,
  nonce: Uint8Array,
): Uint8Array {
  return lengthPrefixed([text('arca-step-up/v1'), text(purpose), subject, nonce]);
}
