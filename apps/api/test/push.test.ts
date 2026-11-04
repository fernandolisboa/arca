import { createECDH, createDecipheriv, createHmac, randomBytes, webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  NotPushServiceError,
  PushRejectedError,
  vapidPushSender,
  type PushSubscriptionKeys,
} from '../src/notification/push.js';
import { vapidKeysFor, type VapidKeys } from '../src/notification/vapid.js';

const contact = 'https://preview.example.com';
const endpoint = 'https://fcm.googleapis.com/fcm/send/synthetic-subscription';

function vapidKeyPair(): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: Buffer.concat([Buffer.alloc(32), ecdh.getPrivateKey()])
      .subarray(-32)
      .toString('base64url'),
  };
}

/** Checks the VAPID token's ES256 signature with the public key, and returns its claims. */
async function verifiedClaims(token: string, publicKey: string): Promise<unknown> {
  const [header, claims, signature] = token.split('.') as [string, string, string];
  const point = Buffer.from(publicKey, 'base64url');
  const key = await webcrypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33).toString('base64url'),
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const valid = await webcrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    Buffer.from(signature, 'base64url'),
    Buffer.from(`${header}.${claims}`),
  );
  expect(valid).toBe(true);
  return JSON.parse(Buffer.from(claims, 'base64url').toString('utf8'));
}

/** A browser's side of a subscription: its ECDH key pair and auth secret. */
function browser() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const subscription: PushSubscriptionKeys = {
    endpoint,
    p256dh: ecdh.getPublicKey().toString('base64url'),
    authSecret: auth.toString('base64url'),
  };
  return { ecdh, auth, subscription };
}

const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();

/** Opens an aes128gcm body as the browser does (RFC 8291 section 3, RFC 8188), to read it back. */
function decrypt(body: Buffer, { ecdh, auth }: ReturnType<typeof browser>): string {
  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  const serverKey = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const shared = ecdh.computeSecret(serverKey);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    ecdh.getPublicKey(),
    serverKey,
    Buffer.from([1]),
  ]);
  const ikm = hmac(hmac(auth, shared), keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  return padded.subarray(0, padded.lastIndexOf(2)).toString('utf8');
}

function recordingFetch(status: number) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch: typeof globalThis.fetch = (url, init) => {
    requests.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {} });
    return Promise.resolve(new Response(null, { status }));
  };
  return { requests, fetch };
}

describe('the VAPID push sender (spec 0005, R7)', () => {
  it('sends only the code and the message ID, encrypted to the subscription, signed with the key', async () => {
    const keys = vapidKeyPair();
    const device = browser();
    const { requests, fetch } = recordingFetch(201);
    const sender = vapidPushSender({ keys, contact, fetch });
    const id = '4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d';

    expect(await sender.send(device.subscription, { code: 'new_sign_in', id })).toBe('delivered');

    const [request] = requests;
    expect(request?.url).toBe(endpoint);
    expect(request?.init).toMatchObject({ method: 'POST', redirect: 'error' });
    const headers = new Headers(request?.init.headers);
    expect(headers.get('content-encoding')).toBe('aes128gcm');
    expect(headers.get('ttl')).toBe('86400');
    expect(headers.get('urgency')).toBe('high');
    const [, token, k] = /^vapid t=([\w.-]+), k=([\w-]+)$/.exec(
      headers.get('authorization') ?? '',
    ) ?? ['', '', ''];
    expect(k).toBe(keys.publicKey);
    expect(await verifiedClaims(token, keys.publicKey)).toMatchObject({
      aud: 'https://fcm.googleapis.com',
      sub: contact,
    });
    const body = Buffer.from(request?.init.body as ArrayBuffer);
    expect(JSON.parse(decrypt(body, device))).toEqual({ code: 'new_sign_in', id });
  });

  it.each([
    [404, 'gone'],
    [410, 'gone'],
    [201, 'delivered'],
  ] as const)('reads %i as %s', async (status, outcome) => {
    const keys = vapidKeyPair();
    const sender = vapidPushSender({ keys, contact, fetch: recordingFetch(status).fetch });
    expect(await sender.send(browser().subscription, { code: 'passkey_added', id: 'x' })).toBe(
      outcome,
    );
  });

  it('throws on any other answer, so the step retries', async () => {
    const keys = vapidKeyPair();
    const sender = vapidPushSender({ keys, contact, fetch: recordingFetch(429).fetch });
    await expect(
      sender.send(browser().subscription, { code: 'passkey_added', id: 'x' }),
    ).rejects.toBeInstanceOf(PushRejectedError);
  });

  it('never reaches a host that is no push service', async () => {
    const keys = vapidKeyPair();
    const { requests, fetch } = recordingFetch(201);
    const sender = vapidPushSender({ keys, contact, fetch });
    const subscription = { ...browser().subscription, endpoint: 'https://169.254.169.254/x' };
    await expect(
      sender.send(subscription, { code: 'passkey_added', id: 'x' }),
    ).rejects.toBeInstanceOf(NotPushServiceError);
    expect(requests).toEqual([]);
  });
});

describe("an environment's VAPID keys", () => {
  it('pairs the private key with the committed public key', () => {
    const { publicKey, privateKey } = vapidKeyPair();
    const keys = { production: null, preview: publicKey, development: null };
    expect(vapidKeysFor('preview', privateKey, keys)).toEqual({ publicKey, privateKey });
  });

  it('leaves push off without a public key, without a private key, or with a mismatched or malformed one', () => {
    const { publicKey, privateKey } = vapidKeyPair();
    const keys = { production: null, preview: publicKey, development: null };
    expect(vapidKeysFor('production', privateKey, keys)).toBeUndefined();
    expect(vapidKeysFor('preview', undefined, keys)).toBeUndefined();
    expect(vapidKeysFor('preview', vapidKeyPair().privateKey, keys)).toBeUndefined();
    expect(vapidKeysFor('preview', 'not a key', keys)).toBeUndefined();
    expect(vapidKeysFor('preview', 'A'.repeat(43), keys)).toBeUndefined();
  });
});
