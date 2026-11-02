import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/**
 * Whether an `Authorization` header carries `Bearer <secret>`. Both sides are hashed first, so the
 * comparison takes the same time whatever the lengths, and the secret's length does not leak.
 */
export function bearerMatches(header: string | undefined, secret: string): boolean {
  if (secret === '') return false;
  return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${secret}`));
}
