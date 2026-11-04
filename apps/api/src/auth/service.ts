import { SessionResponse } from '@arca/api-contract/routes';
import { APIError } from 'better-auth/api';
import type { Auth } from './auth.js';

/** No session lives longer than this, however active it is (spec 0003, R4). */
export const absoluteSessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;

export interface RefreshedSession {
  readonly session: SessionResponse | null;
  /** Better Auth's cookies for the slid expiry, to pass on to the client unchanged. */
  readonly setCookies: readonly string[];
}

/** The account and session a request is signed in with. */
export interface SignedIn {
  readonly accountId: string;
  readonly sessionId: string;
}

/** What the API needs from Better Auth; tests give a fake. */
export interface AuthService {
  /** Hands an allow-listed request to Better Auth unchanged. */
  readonly handle: (request: Request) => Promise<Response>;
  /** The account and session signed in with these request headers, or null when none is. */
  readonly signedIn: (headers: Headers) => Promise<SignedIn | null>;
  /** The same, sliding the idle expiry; only GET /v1/session calls it, and forwards the cookies. */
  readonly refresh: (headers: Headers) => Promise<RefreshedSession>;
}

type Found = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

function live(found: Found | null, now: Date): found is Found {
  return (
    found !== null && now.getTime() - found.session.createdAt.getTime() < absoluteSessionLifetimeMs
  );
}

/** Parsed, so a stored device value outside the enums fails loudly instead of reaching a client. */
function toResponse(found: Found | null, now: Date): SessionResponse | null {
  if (!live(found, now)) return null;
  return SessionResponse.parse({
    accountId: found.user.id,
    email: found.user.email,
    confirmed: found.user.confirmedAt !== null && found.user.confirmedAt !== undefined,
    device: { browser: found.session.deviceBrowser, os: found.session.deviceOs },
  });
}

/** A session deleted while it was being read (a sign-out in another tab) is no session. */
async function unlessGone<T>(read: Promise<T>, gone: T): Promise<T> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof APIError && error.statusCode === 401) return gone;
    throw error;
  }
}

export function authService(auth: Auth, clock: () => Date = () => new Date()): AuthService {
  const read = (headers: Headers) =>
    unlessGone(
      auth.api.getSession({ headers, query: { disableRefresh: true }, returnHeaders: true }),
      { response: null, headers: new Headers() },
    );
  return {
    handle: (request) => auth.handler(request),
    // No sliding refresh here: it would move the stored expiry without the cookie that carries it.
    signedIn: async (headers) => {
      const found = (await read(headers)).response;
      return live(found, clock())
        ? { accountId: found.user.id, sessionId: found.session.id }
        : null;
    },
    // The absolute lifetime is checked before sliding, so a session past it is never extended.
    refresh: async (headers) => {
      const current = await read(headers);
      const session = toResponse(current.response, clock());
      if (session === null) return { session, setCookies: current.headers.getSetCookie() };
      const slid = await unlessGone(auth.api.getSession({ headers, returnHeaders: true }), {
        response: null,
        headers: new Headers(),
      });
      return { session, setCookies: slid.headers.getSetCookie() };
    },
  };
}
