import { base64urlnopad } from '@scure/base';

function bytesOf(source: BufferSource): Uint8Array<ArrayBuffer> {
  const view = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
  return new Uint8Array(view);
}

const prfDomain = new TextEncoder().encode('WebAuthn PRF\0');

async function evaluate(secret: Uint8Array<ArrayBuffer>, input: BufferSource): Promise<Uint8Array> {
  const salt = await crypto.subtle.digest(
    'SHA-256',
    new Uint8Array([...prfDomain, ...bytesOf(input)]),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, salt));
}

/**
 * A software authenticator answering `navigator.credentials.get` for the PRF extension as a
 * CTAP2 one does through hmac-secret: HMAC-SHA-256 under the credential's secret over
 * SHA-256("WebAuthn PRF" || 0x00 || input). Synthetic secrets only.
 */
export function fakePrfAuthenticator(
  relyingPartyId: string,
  secrets: ReadonlyMap<string, Uint8Array<ArrayBuffer>>,
): Pick<CredentialsContainer, 'get'> {
  return {
    get: async (options) => {
      const request = options?.publicKey;
      const allowed = request?.allowCredentials ?? [];
      const prf = request?.extensions?.prf?.eval;
      if (
        request?.rpId !== relyingPartyId ||
        request.userVerification !== 'required' ||
        allowed.length !== 1 ||
        prf?.second === undefined
      ) {
        throw new TypeError('unexpected ceremony');
      }
      const [credential] = allowed;
      const secret = credential && secrets.get(base64urlnopad.encode(bytesOf(credential.id)));
      if (secret === undefined) throw new DOMException('no such credential', 'NotAllowedError');
      const results = {
        first: await evaluate(secret, prf.first),
        second: await evaluate(secret, prf.second),
      };
      return { getClientExtensionResults: () => ({ prf: { results } }) } as unknown as Credential;
    },
  };
}
