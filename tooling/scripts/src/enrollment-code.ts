import { createHash, randomBytes } from 'node:crypto';

export interface EnrollmentCode {
  /** 128 random bits, base64url: the owner keeps it and types it at enrollment. */
  readonly code: string;
  /** Its SHA-256 in hex: the only part that goes into the repository (spec 0003, R2). */
  readonly hash: string;
}

export function enrollmentCode(random: (size: number) => Buffer = randomBytes): EnrollmentCode {
  const code = random(16).toString('base64url');
  return { code, hash: createHash('sha256').update(code).digest('hex') };
}

/**
 * Run by the owner on their own computer. The code never goes into a model, an issue, a pull
 * request, a commit or a log; only the hash is handed over, for apps/api/src/auth/enrollment-code-hash.ts.
 */
if (import.meta.main) {
  const { code, hash } = enrollmentCode();
  process.stdout.write(
    [
      'Enrollment code (keep it to yourself; you type it once, at enrollment):',
      `  ${code}`,
      '',
      'Its hash (the only part to share, for apps/api/src/auth/enrollment-code-hash.ts):',
      `  ${hash}`,
      '',
    ].join('\n'),
  );
}
