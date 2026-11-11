import { createI18n } from '@arca/i18n';
import { describe, expect, it } from 'vitest';
import { parseSeen, serializeSeen } from '../src/tour/seen.js';
import { appTour, nextTour, screenHints, tours } from '../src/tour/tours.js';

const seen = (...ids: string[]) => new Set(ids);

describe('nextTour', () => {
  it('starts the first-run tour on the home screen only', () => {
    expect(nextTour('/', seen())).toBe(appTour);
    expect(nextTour('/family', seen())).toBeUndefined();
  });

  it('shows a screen its hint once the first-run tour is over, and only once', () => {
    expect(nextTour('/family', seen('app'))?.id).toBe('family');
    expect(nextTour('/family', seen('app', 'family'))).toBeUndefined();
    expect(nextTour('/', seen('app'))).toBeUndefined();
    expect(nextTour('/settings', seen('app'))).toBeUndefined();
  });
});

describe('tours', () => {
  it('have unique ids, and a hint is a single step', () => {
    expect(new Set(tours.map((tour) => tour.id)).size).toBe(tours.length);
    expect(screenHints.every((hint) => hint.steps.length === 1)).toBe(true);
  });

  it('have a pt-BR title and body for every step', async () => {
    const i18n = await createI18n();
    const keys = tours.flatMap((tour) =>
      tour.steps.flatMap((step) =>
        ['title', 'body'].map((part) => `tour.${tour.id}.${step.id}.${part}`),
      ),
    );
    expect(keys.filter((key) => !i18n.exists(key))).toEqual([]);
  });
});

describe('seen tours', () => {
  it('survive a round trip through storage', () => {
    expect(parseSeen(serializeSeen(seen('family', 'app')))).toEqual(seen('app', 'family'));
  });

  it.each([null, '', 'not json', '[]', '{"v":2,"seen":["app"]}', '{"v":1,"seen":"app"}'])(
    'read %j as nothing seen',
    (raw) => {
      expect(parseSeen(raw)).toEqual(seen());
    },
  );

  it('keep only text ids', () => {
    expect(parseSeen('{"v":1,"seen":["app",3,null]}')).toEqual(seen('app'));
  });
});
