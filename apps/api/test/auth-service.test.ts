import { APIError } from 'better-auth/api';
import { describe, expect, it } from 'vitest';
import type { Auth } from '../src/auth/auth.js';
import { authService } from '../src/auth/service.js';

/** Better Auth when a sign-out in another tab deleted the session mid-read. */
const deletedMidRead = {
  handler: () => Promise.resolve(new Response(null, { status: 500 })),
  api: { getSession: () => Promise.reject(new APIError('UNAUTHORIZED')) },
} as unknown as Auth;

describe('reading a session that disappears meanwhile', () => {
  const service = authService(deletedMidRead);

  it('treats it as no session', async () => {
    await expect(service.signedIn(new Headers())).resolves.toBeNull();
  });

  it('refreshes nothing and sets no cookie', async () => {
    await expect(service.refresh(new Headers())).resolves.toEqual({
      session: null,
      setCookies: [],
    });
  });

  it('still surfaces any other failure', async () => {
    const broken = {
      api: { getSession: () => Promise.reject(new Error('database down')) },
    } as unknown as Auth;
    await expect(authService(broken).signedIn(new Headers())).rejects.toThrow('database down');
  });
});
