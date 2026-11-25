import { ptBR } from '@arca/i18n/catalog';
import { departureChecklists } from '@arca/knowledge';
import type { Logger } from '@arca/telemetry';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { SignedIn } from '../src/auth/service.js';
import { noLimits } from './limits.js';

const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const owner: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};

function appFor(signedIn: SignedIn | null) {
  return createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin: 'http://arca.test',
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(signedIn),
      refresh: () => Promise.resolve({ session: null, setCookies: [] }),
    },
    authLimits: noLimits,
    departureChecklists,
  });
}

describe('GET /v1/departure-checklists (ADR-0037)', () => {
  it('answers the repository checklists to a signed-in account', async () => {
    const response = await appFor(owner).request('/v1/departure-checklists');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { checklists: typeof departureChecklists };
    expect(body.checklists).toEqual(departureChecklists);
    expect(body.checklists.map(({ country }) => country)).toContain('BR');
  });

  it('refuses a request with no session', async () => {
    const response = await appFor(null).request('/v1/departure-checklists');
    expect(response.status).toBe(401);
  });
});

describe('the departure checklists’ wording (ADR-0037)', () => {
  const { section, item } = ptBR.departure as {
    section: Record<string, string>;
    item: Record<string, { title: string; body: string }>;
  };
  const sections = departureChecklists.flatMap((checklist) => checklist.sections);
  const items = sections.flatMap((entry) => entry.items);

  it('names every section and item the file lists', () => {
    expect(sections.map(({ id }) => id).filter((id) => section[id] === undefined)).toEqual([]);
    expect(
      items.map(({ id }) => id).filter((id) => item[id]?.title === undefined || !item[id].body),
    ).toEqual([]);
  });

  it('words no item the file does not list', () => {
    const listed = new Set(items.map(({ id }) => id));
    expect(Object.keys(item).filter((id) => !listed.has(id))).toEqual([]);
  });
});
