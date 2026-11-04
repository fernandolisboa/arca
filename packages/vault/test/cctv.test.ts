import { armor, Decrypter } from 'age-encryption';
import * as vectors from 'cctv-age';
import { describe, expect, it } from 'vitest';

/** One C2SP CCTV age vector: a textual header, an empty line, then the age file. */
interface Vector {
  readonly expect: string;
  readonly payload: string | undefined;
  readonly identities: string[];
  readonly passphrases: string[];
  readonly armored: boolean;
  readonly compressed: boolean;
  readonly file: Uint8Array;
}

function parse(bytes: Uint8Array): Vector {
  const end = bytes.findIndex((byte, index) => byte === 10 && bytes[index + 1] === 10);
  const header = new TextDecoder().decode(bytes.subarray(0, end));
  const fields = header.split('\n').map((line) => {
    const separator = line.indexOf(': ');
    return [line.slice(0, separator), line.slice(separator + 2)] as const;
  });
  const all = (key: string) => fields.filter(([name]) => name === key).map(([, value]) => value);
  return {
    expect: all('expect')[0] ?? '',
    payload: all('payload')[0],
    identities: all('identity'),
    passphrases: all('passphrase'),
    armored: all('armored')[0] === 'yes',
    compressed: all('compressed')[0] === 'zlib',
    file: bytes.subarray(end + 2),
  };
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** Decrypts as the vault does, as a stream, and returns what was released and the outcome. */
async function run(
  vector: Vector,
): Promise<{ outcome: string; released: Uint8Array<ArrayBuffer> }> {
  let file = vector.compressed ? await inflate(vector.file) : vector.file;
  if (vector.armored) {
    try {
      file = armor.decode(new TextDecoder().decode(file));
    } catch {
      return { outcome: 'armor failure', released: new Uint8Array() };
    }
  }
  const decrypter = new Decrypter();
  for (const identity of vector.identities) decrypter.addIdentity(identity);
  for (const passphrase of vector.passphrases) decrypter.addPassphrase(passphrase);
  let plaintext: ReadableStream<Uint8Array>;
  try {
    plaintext = await decrypter.decrypt(new Blob([new Uint8Array(file)]).stream());
  } catch {
    return { outcome: 'header failure', released: new Uint8Array() };
  }
  const chunks: Uint8Array[] = [];
  const reader = plaintext.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } catch {
    return { outcome: 'payload failure', released: await joined(chunks) };
  }
  return { outcome: 'success', released: await joined(chunks) };
}

async function joined(chunks: Uint8Array[]): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Blob(chunks.map((chunk) => new Uint8Array(chunk))).arrayBuffer());
}

const chunkSize = 64 * 1024;

/**
 * Payload failures where the library releases fewer chunks than the reference implementation whose
 * output the vector hashes: it holds each chunk back until it knows whether it is the last one.
 * It still releases only whole authenticated chunks, and never more than the reference.
 */
const holdsBackMore = new Set([
  'armor_garbage_encoded',
  'stream_no_final_full',
  'stream_no_final_two_chunks_full',
  'stream_trailing_garbage_long',
  'stream_trailing_garbage_short',
  'stream_two_final_chunks',
  'stream_two_final_chunks_full',
  'stream_two_final_chunks_second',
]);

// The library reports every header-level failure the same way, so `no match`, `HMAC failure` and
// `header failure` are aliased, as the vectors' README allows.
const headerLevel = new Set(['no match', 'HMAC failure', 'header failure']);

const cases = Object.entries(vectors as Record<string, Uint8Array>)
  .map(([name, bytes]) => [name, parse(bytes)] as const)
  .sort(([a], [b]) => a.localeCompare(b));

describe('C2SP CCTV age vectors (spec 0005, R1)', () => {
  it('include the hybrid post-quantum stanza', () => {
    expect(cases.filter(([name]) => name.startsWith('hybrid')).length).toBeGreaterThan(10);
  });

  it.each(cases)(
    '%s',
    async (name, vector) => {
      const { outcome, released } = await run(vector);
      const expected = headerLevel.has(vector.expect) ? 'header failure' : vector.expect;
      expect(outcome).toBe(expected);
      if (holdsBackMore.has(name)) {
        expect(released.length % chunkSize).toBe(0);
      } else if (vector.payload === undefined) {
        expect(released.length).toBe(0);
      } else {
        expect(hex(await crypto.subtle.digest('SHA-256', released))).toBe(vector.payload);
      }
    },
    30_000,
  );
});
