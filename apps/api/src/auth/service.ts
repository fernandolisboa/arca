import { SessionResponse } from '@arca/api-contract/routes';
import type { Auth } from './auth.js';

/** What the API needs from Better Auth; tests give a fake. */
export interface AuthService {
  /** Hands an allow-listed request to Better Auth unchanged. */
  readonly handle: (request: Request) => Promise<Response>;
  /** The signed-in session for these request headers, or null when there is none. */
  readonly session: (headers: Headers) => Promise<SessionResponse | null>;
}

export function authService(auth: Auth): AuthService {
  return {
    handle: (request) => auth.handler(request),
    session: async (headers) => {
      const found = await auth.api.getSession({ headers });
      if (found === null) return null;
      // Parsed, so a stored device value outside the enums fails loudly instead of reaching a client.
      return SessionResponse.parse({
        accountId: found.user.id,
        email: found.user.email,
        device: { browser: found.session.deviceBrowser, os: found.session.deviceOs },
      });
    },
  };
}
