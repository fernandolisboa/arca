import { ptBR } from '@arca/i18n/catalog';
import { createHash } from 'node:crypto';
import { recognitionTracks, recognitionWordingSha256 } from '@arca/knowledge';
import type { Logger } from '@arca/telemetry';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { SignedIn } from '../src/auth/service.js';
import type { CaseFiles } from '../src/case/case-files.js';
import { noLimits } from './limits.js';

const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const owner: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};
const doctor = '8d3e4f50-6172-4839-8a4b-5c6d7e8f9a0b';

function appFor(
  signedIn: SignedIn | null,
  { confirmed = true, inCase = true }: { confirmed?: boolean; inCase?: boolean } = {},
) {
  const calls: unknown[][] = [];
  const cases = {
    recognitionHolders: (accountId: string, tracks: readonly { id: string }[]) => {
      calls.push([accountId, tracks.map(({ id }) => id)]);
      return Promise.resolve(
        inCase ? tracks.map(({ id }) => ({ trackId: id, personIds: [doctor] })) : null,
      );
    },
  } as unknown as CaseFiles;
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin: 'http://arca.test',
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(signedIn),
      refresh: () => Promise.resolve({ session: null, setCookies: [] }),
    },
    authLimits: noLimits,
    cases,
    accountConfirmed: () => Promise.resolve(confirmed),
    recognitionTracks,
  });
  return { app, calls };
}

interface Body {
  tracks: { id: string; destinations: { country: string; steps: { id: string }[] }[] }[];
  holders: { trackId: string; personIds: string[] }[];
}

describe('GET /v1/recognition-tracks (ADR-0040)', () => {
  it('answers the repository tracks and whom in the case each concerns', async () => {
    const { app, calls } = appFor(owner);
    const response = await app.request('/v1/recognition-tracks');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Body;
    expect(body.tracks.map(({ id }) => id)).toEqual(recognitionTracks.map(({ id }) => id));
    expect(body.tracks[0]?.destinations.map(({ country }) => country)).toEqual(['ES', 'PT', 'US']);
    // The occupation codes stay on the server: the screen needs only the track and its steps.
    expect(body.tracks[0]).not.toHaveProperty('occupations');
    expect(body.holders).toEqual([{ trackId: 'physician', personIds: [doctor] }]);
    expect(calls).toEqual([[owner.accountId, ['physician']]]);
  });

  it('answers the tracks with nobody named outside a case or before the account is confirmed', async () => {
    for (const options of [{ inCase: false }, { confirmed: false }]) {
      const { app } = appFor(owner, options);
      const body = (await (await app.request('/v1/recognition-tracks')).json()) as Body;
      expect(body.tracks.length).toBeGreaterThan(0);
      expect(body.holders).toEqual([]);
    }
    const unconfirmed = appFor(owner, { confirmed: false });
    await unconfirmed.app.request('/v1/recognition-tracks');
    expect(unconfirmed.calls).toEqual([]);
  });

  it('refuses a request with no session', async () => {
    const response = await appFor(null).app.request('/v1/recognition-tracks');
    expect(response.status).toBe(401);
  });
});

describe('the recognition tracks’ wording (ADR-0040)', () => {
  const { track, item } = ptBR.recognition as {
    track: Record<string, string>;
    item: Record<string, { title: string; body: string }>;
  };
  const steps = recognitionTracks.flatMap(({ destinations }) =>
    destinations.flatMap((destination) => destination.steps),
  );

  it('names every track and step the file lists', () => {
    expect(recognitionTracks.map(({ id }) => id).filter((id) => !track[id])).toEqual([]);
    expect(steps.map(({ id }) => id).filter((id) => !item[id]?.title || !item[id].body)).toEqual(
      [],
    );
  });

  it('words no track or step the file does not list', () => {
    const tracks = new Set(recognitionTracks.map(({ id }) => id));
    const listed = new Set(steps.map(({ id }) => id));
    expect(Object.keys(track).filter((id) => !tracks.has(id))).toEqual([]);
    expect(Object.keys(item).filter((id) => !listed.has(id))).toEqual([]);
  });

  it('carries no link, so every address comes from the reviewed sources', () => {
    const texts = [
      ...Object.values(track),
      ...Object.values(item).flatMap(({ title, body }) => [title, body]),
    ];
    expect(texts.filter((text) => /https?:|www\./i.test(text))).toEqual([]);
  });

  it('is the wording the file was checked against, so a wording change also changes the file', () => {
    const sha256 = createHash('sha256').update(JSON.stringify({ track, item })).digest('hex');
    expect(recognitionWordingSha256).toBe(sha256);
  });
});
