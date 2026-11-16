import { createHash } from 'node:crypto';
import { type Json, canonicalize } from '../src/canonical.ts';

/** SHA-256, in lowercase hex, of the UTF-8 bytes of the RFC 8785 canonical form (spec 0002, R6). */
export function contentHash(value: Json): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}
