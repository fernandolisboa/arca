import { ptBR } from '@arca/i18n/catalog';

type Codes = Exclude<keyof typeof ptBR.push, 'fallback'>;

export interface PushNotice {
  readonly title: string;
  readonly body: string;
  /** One notice per message, so a push delivered twice shows once. */
  readonly tag: string;
}

const messageId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCode(code: unknown): code is Codes {
  return typeof code === 'string' && code !== 'fallback' && Object.hasOwn(ptBR.push, code);
}

/**
 * The text a push shows (spec 0005, R7). The payload carries only a code and the message ID, so
 * the words come from the catalog; anything unexpected gets the generic notice, never its own text.
 */
export function pushNotice(payload: unknown): PushNotice {
  const { code, id } = (typeof payload === 'object' && payload !== null ? payload : {}) as {
    code?: unknown;
    id?: unknown;
  };
  const text = isCode(code) ? ptBR.push[code] : ptBR.push.fallback;
  const tag = typeof id === 'string' && messageId.test(id) ? `arca-${id.toLowerCase()}` : 'arca';
  return { title: text.title, body: text.body, tag };
}

/** Reads a push's data as JSON, or nothing when it is not. */
export function pushPayload(data: { json(): unknown } | null): unknown {
  try {
    return data?.json();
  } catch {
    return undefined;
  }
}
