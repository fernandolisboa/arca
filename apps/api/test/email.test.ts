import { browserFamilies, osFamilies, type DeviceDescription } from '@arca/api-contract/routes';
import { createI18n } from '@arca/i18n';
import type { Database } from '@arca/db';
import { describe, expect, it } from 'vitest';
import {
  EmailNotConfiguredError,
  EmailRejectedError,
  unconfiguredSender,
} from '../src/email/email.js';
import {
  accountsOpenWith,
  emailRouteFor,
  emailSenderFor,
  outboxReaderFor,
} from '../src/email/environment.js';
import { createNotices, noticeKinds, noticeMessage, type Notice } from '../src/email/notices.js';
import { OutboxInProductionError, outboxSender, readOutbox } from '../src/email/outbox.js';
import { resendSender } from '../src/email/resend.js';

const at = new Date('2026-11-04T15:30:00Z');
const origin = 'https://preview.example.com';

function notice(kind: (typeof noticeKinds)[number]): Notice {
  return kind === 'new_sign_in'
    ? { kind, to: 'owner@example.com', at, device: { browser: 'firefox', os: 'linux' } }
    : { kind, to: 'owner@example.com', at };
}

describe('security notices (spec 0003, R7 and R8)', () => {
  it.each(noticeKinds)('renders %s from the catalog with one link to the app', async (kind) => {
    const missing: string[] = [];
    const i18n = await createI18n({ onMissingKey: (key) => missing.push(key) });
    const message = noticeMessage(i18n, origin, notice(kind));
    expect(missing).toEqual([]);
    expect(message.to).toBe('owner@example.com');
    expect(message.subject).not.toBe('');
    expect(message.text).toContain('4 de novembro de 2026 às 12:30 (horário de Brasília)');
    expect(message.text.match(/https?:\/\/\S+/g)).toEqual([`${origin}/`]);
    // Nothing personal beyond the address it goes to, which the text never repeats.
    expect(message.text).not.toContain('owner@example.com');
  });

  it('names only the device families in the new-sign-in notice', async () => {
    const message = noticeMessage(await createI18n(), origin, notice('new_sign_in'));
    expect(message.text).toContain('Navegador: Firefox. Sistema: Linux.');
  });

  const devices: DeviceDescription[] = browserFamilies.flatMap((browser) =>
    osFamilies.map((os) => ({ browser, os })),
  );

  it.each(devices)('names $browser on $os from the catalog', async (device) => {
    const message = noticeMessage(await createI18n(), origin, {
      kind: 'new_sign_in',
      to: 'owner@example.com',
      at,
      device,
    });
    const generic = (message.text.match(/não identificado/g) ?? []).length;
    expect(generic).toBe(Number(device.browser === 'other') + Number(device.os === 'other'));
  });

  it('names an unknown family generically', async () => {
    const message = noticeMessage(await createI18n(), origin, {
      kind: 'new_sign_in',
      to: 'owner@example.com',
      at,
      device: { browser: 'other', os: 'other' },
    });
    expect(message.text).toContain('Navegador: não identificado. Sistema: não identificado.');
  });

  it('hands the rendered message to the sender', async () => {
    const sent: unknown[] = [];
    const notices = createNotices({
      email: { send: (message) => Promise.resolve(void sent.push(message)) },
      i18n: await createI18n(),
      origin,
    });
    await notices.send(notice('passkey_added'));
    expect(sent).toHaveLength(1);
  });
});

describe('the Resend adapter', () => {
  function fakeFetch(status: number) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch: typeof globalThis.fetch = (url, init) => {
      calls.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {} });
      return Promise.resolve(new Response('{"message":"for owner@example.com"}', { status }));
    };
    return { calls, fetch };
  }

  const message = { to: 'owner@example.com', subject: 'Assunto', text: 'Texto' };

  it('posts the message to the REST API with the key as a bearer token', async () => {
    const { calls, fetch } = fakeFetch(200);
    await resendSender({ apiKey: 're_test_only', from: 'Arca <avisos@example.com>', fetch }).send(
      message,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.resend.com/emails');
    expect(calls[0]?.init.method).toBe('POST');
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer re_test_only');
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      from: 'Arca <avisos@example.com>',
      to: ['owner@example.com'],
      subject: 'Assunto',
      text: 'Texto',
    });
  });

  it('keeps only the status of a refusal, never the response body', async () => {
    const { fetch } = fakeFetch(422);
    const sending = resendSender({ apiKey: 'k', from: 'Arca <avisos@example.com>', fetch }).send(
      message,
    );
    await expect(sending).rejects.toThrow(EmailRejectedError);
    await expect(sending).rejects.toThrow('the email provider answered 422');
  });
});

describe('choosing a sender', () => {
  const db = {} as Database;

  it('refuses the outbox in production', async () => {
    expect(() => outboxSender(db, 'production')).toThrow(OutboxInProductionError);
    await expect(readOutbox(db, 'production')).rejects.toThrow(OutboxInProductionError);
  });

  const site = { host: 'arca.example.com', senderDomain: 'arca.example.com' } as const;

  it.each([
    ['no host', { ...site, host: null }, 're_key'],
    ['no sending domain', { ...site, senderDomain: null }, 're_key'],
    ['no key', site, undefined],
  ] as const)('closes production to new accounts with %s (spec 0003, R9)', (_, given, key) => {
    const route = emailRouteFor('production', given, key);
    expect(route).toEqual({ via: 'none' });
    expect(accountsOpenWith(route)).toBe(false);
  });

  it('sends through Resend from the sending domain once production has all three', () => {
    const route = emailRouteFor('production', site, 're_key');
    expect(route).toEqual({
      via: 'resend',
      apiKey: 're_key',
      from: 'Arca <no-reply@arca.example.com>',
    });
    expect(accountsOpenWith(route)).toBe(true);
  });

  it.each(['preview', 'development'] as const)(
    'keeps %s on the outbox, open to new accounts, whatever the key',
    (environment) => {
      const route = emailRouteFor(environment, { host: null, senderDomain: null }, 're_key');
      expect(route).toEqual({ via: 'outbox' });
      expect(accountsOpenWith(route)).toBe(true);
    },
  );

  it('sends nothing in production until the sending domain is configured', async () => {
    const sending = emailSenderFor({ via: 'none' }, 'production', () => db).send({
      to: 'owner@example.com',
      subject: 's',
      text: 't',
    });
    await expect(sending).rejects.toThrow(EmailNotConfiguredError);
  });

  it.each(['preview', 'development'] as const)(
    'writes to the outbox on %s',
    async (environment) => {
      const sent: string[] = [];
      const fake = {
        transaction: (run: (tx: unknown) => Promise<void>) =>
          run({
            delete: () => ({ where: () => Promise.resolve() }),
            insert: () => ({
              values: (row: { recipient: string }) =>
                Promise.resolve(void sent.push(row.recipient)),
            }),
          }),
      } as unknown as Database;
      await emailSenderFor({ via: 'outbox' }, environment, () => fake).send({
        to: 'owner@example.com',
        subject: 's',
        text: 't',
      });
      expect(sent).toEqual(['owner@example.com']);
    },
  );

  it('shows the outbox on previews only', () => {
    expect(outboxReaderFor('preview', () => db)).toBeTypeOf('function');
    expect(outboxReaderFor('production', () => db)).toBeUndefined();
    expect(outboxReaderFor('development', () => db)).toBeUndefined();
  });

  it('refuses to send while no sending domain is configured', async () => {
    await expect(
      unconfiguredSender.send({ to: 'owner@example.com', subject: 's', text: 't' }),
    ).rejects.toThrow(EmailNotConfiguredError);
  });
});
