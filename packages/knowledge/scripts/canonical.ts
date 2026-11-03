import { createHash } from 'node:crypto';
import type { Json } from './json.ts';

/**
 * RFC 8785 (JCS) serialization. ECMAScript's own string and number serialization is the one the RFC
 * specifies (section 3.2.2), so `JSON.stringify` serializes primitives; what JCS adds is sorting
 * keys by UTF-16 code units and refusing lone surrogates and non-finite numbers.
 */
export function canonicalize(value: Json): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('JCS has no NaN or Infinity');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    if (!value.isWellFormed()) throw new RangeError('JCS refuses lone surrogates');
    return JSON.stringify(value);
  }
  if (isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  // The default sort compares UTF-16 code units, which is the order JCS sets (section 3.2.3).
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${canonicalize(key)}:${canonicalize(value[key] ?? null)}`).join(',')}}`;
}

/** SHA-256, in lowercase hex, of the UTF-8 bytes of the canonical form. */
export function contentHash(value: Json): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

function isArray(value: Json): value is readonly Json[] {
  return Array.isArray(value);
}
