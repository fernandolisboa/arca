/**
 * The SHA-256 (hex) of the owner's enrollment code (spec 0003, R2). The owner runs
 * `pnpm enrollment-code` on their own computer, keeps the code and hands over only this hash;
 * null until then, which keeps owner enrollment closed.
 */
export const enrollmentCodeHash: string | null = null;
