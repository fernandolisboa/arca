import { SessionResponse } from '@arca/api-contract/routes';
import type { Auth } from './auth.js';

/** No session lives longer than this, however active it is (spec 0003, R4). */
export const absoluteSessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;

export interface RefreshedSession {
  readonly session: SessionResponse | null;
  /** Better Auth's cookies for the slid expiry, to pass on to the client unchanged. */
  readonly setCookies: readonly string[];
}

/** What the API needs from Better Auth; tests give a fake. */
export interface AuthService {
  /** Hands an allow-listed request to Better Auth unchanged. */
  readonly handle: (request: Request) => Promise<Response>;
  /** The signed-in session for these request headers, or null when there is none. */
  readonly session: (headers: Headers) => Promise<SessionResponse | null>;
  /** The same, sliding the idle expiry; only GET /v1/session calls it, and forwards the cookies. */
  readonly refresh: (headers: Headers) => Promise<RefreshedSession>;
}

type Found = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

/** Parsed, so a stored device value outside the enums fails loudly instead of reaching a client. */
function toResponse(found: Found | null, now: Date): SessionResponse | null {
  if (found === null) return null;
  if (now.getTime() - found.session.createdAt.getTime() >= absoluteSessionLifetimeMs) return null;
  return SessionResponse.parse({
    accountId: found.user.id,
    email: found.user.email,
    device: { browser: found.session.deviceBrowser, os: found.session.deviceOs },
  });
}

export function authService(auth: Auth, clock: () => Date = () => new Date()): AuthService {
  return {
    handle: (request) => auth.handler(request),
    // No sliding refresh here: it would move the stored expiry without the cookie that carries it.
    session: async (headers) =>
      toResponse(await auth.api.getSession({ headers, query: { disableRefresh: true } }), clock()),
    refresh: async (headers) => {
      const { response, headers: sent } = await auth.api.getSession({
        headers,
        returnHeaders: true,
      });
      const session = toResponse(response, clock());
      return { session, setCookies: session === null ? [] : sent.getSetCookie() };
    },
  };
}
