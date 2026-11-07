import { describe, expect, it } from 'vitest';
import {
  type CheckAnswer,
  type ReadPage,
  plainNote,
  reportClean,
  scriptedCheckerModel,
  verifyAnswers,
} from '../../src/independent-check/answers.js';
import type { CheckItem } from '../../src/independent-check/items.js';

const law = 'https://www.gov.example/law';
const other = 'https://www.gov.example/other';

const item: CheckItem = {
  key: 'requirement:means',
  kind: 'requirement',
  title: 'Means of subsistence',
  urls: [law],
  officialDomains: [{ id: 'qm-gov', number: 1 }],
  values: [{ kind: 'number', value: '920' }],
};

const page = (patch: Partial<ReadPage> = {}): ReadPage => ({
  url: law,
  text: 'Article 3.\nThe applicant shows a monthly income of at least\n€920,00 for the principal.',
  cut: false,
  chain: [law],
  ...patch,
});

const quote = 'a monthly income of at least €920,00';

function verify(answer: Partial<CheckAnswer> | undefined, read: ReadPage | null = page()) {
  const answers =
    answer === undefined ? [] : [{ key: item.key, status: 'matches' as const, ...answer }];
  const pages = new Map(read === null ? [] : [[read.url, read]]);
  const [checked] = verifyAnswers([item], answers, pages);
  return checked;
}

describe('verifyAnswers', () => {
  it('takes a match whose quote is on the page and states the value', () => {
    expect(verify({ quote, url: law })).toEqual({
      key: item.key,
      status: 'matches',
      quote,
      url: law,
      note: null,
      reason: null,
    });
  });

  it.each<[string, Partial<CheckAnswer> | undefined, ReadPage | null, string]>([
    ['no answer', undefined, page(), 'not_answered'],
    ['the model could not check', { status: 'could_not_check' }, page(), 'model_could_not_check'],
    ['a URL the item does not cite', { quote, url: other }, page(), 'url_not_cited'],
    ['no URL', { quote }, page(), 'url_not_cited'],
    ['a page not read', { quote, url: law }, null, 'page_not_read'],
    ['a quote too short', { quote: '€920,00', url: law }, page(), 'quote_length'],
    ['a quote too long', { quote: 'x'.repeat(801), url: law }, page(), 'quote_length'],
    [
      'a quote not on the page',
      { quote: 'a monthly income of at least €720,00', url: law },
      page(),
      'quote_not_on_page',
    ],
    ['a match from a cut page', { quote, url: law }, page({ cut: true }), 'page_cut'],
    [
      'a match without the value',
      { quote: 'Article 3. The applicant shows', url: law },
      page(),
      'value_not_in_quote',
    ],
    [
      'a quote holding a query value of the chain',
      { quote: 'search results for ninehundred twenty', url: law },
      page({
        text: 'search results for ninehundred twenty euros',
        chain: [law, 'https://www.gov.example/search?q=ninehundred'],
      }),
      'echoes_address',
    ],
    [
      'a value the address already states',
      { quote, url: law },
      page({ chain: [law, 'https://www.gov.example/amounts/920'] }),
      'echoes_address',
    ],
    [
      'a difference from a page whose address states the value',
      { status: 'differs', quote, url: law },
      page({ chain: [law, 'https://www.gov.example/amounts/920'] }),
      'echoes_address',
    ],
  ])('makes %s could not be checked', (_, answer, read, reason) => {
    expect(verify(answer, read)).toMatchObject({
      status: 'could_not_check',
      quote: null,
      url: null,
      note: null,
      reason,
    });
  });

  it('normalizes whitespace on both sides, line breaks included', () => {
    expect(
      verify({ quote: 'monthly income of at least\n\n  €920,00   for', url: law }),
    ).toMatchObject({ status: 'matches', quote: 'monthly income of at least €920,00 for' });
  });

  it('takes a difference with its quote and a plain note, without the value check', () => {
    expect(
      verify({
        status: 'differs',
        quote: 'a monthly income of at least €920,00',
        url: law,
        note: 'The page asks for 920, see https://evil.example and www.evil.example; the rule <b>says</b> 820.',
      }),
    ).toEqual({
      key: item.key,
      status: 'differs',
      quote: 'a monthly income of at least €920,00',
      url: law,
      note: 'The page asks for 920, see and the rule b says /b 820.',
      reason: null,
    });
  });

  it('keeps a difference from a cut page', () => {
    expect(verify({ status: 'differs', quote, url: law }, page({ cut: true }))).toMatchObject({
      status: 'differs',
    });
  });

  it('drops keys of no item and every answer of a key answered twice', () => {
    const answer = { key: item.key, status: 'matches' as const, quote, url: law };
    const pages = new Map([[law, page()]]);
    expect(verifyAnswers([item], [answer, answer], pages)[0]?.reason).toBe('not_answered');
    expect(
      verifyAnswers([item], [answer, { ...answer, key: 'requirement:ghost' }], pages),
    ).toHaveLength(1);
  });
});

describe('plainNote', () => {
  it('caps a long note', () => {
    expect(plainNote('a'.repeat(400))?.length).toBe(300);
  });

  it('answers null for a note that was only a link', () => {
    expect(plainNote('https://evil.example/x')).toBeNull();
  });

  it.each([
    ['The page says EUR 800 (see https://gov.example/x).', 'The page says EUR 800 (see'],
    ['Look at www.evil.example now', 'Look at now'],
    ['Ask evil.example, not the law.', 'Ask not the law.'],
    ['Write to mailto:a@b.example <b>here</b>', 'Write to b here /b'],
    ['The amount is 1.800 euros, not 1.500.', 'The amount is 1.800 euros, not 1.500.'],
    [
      'See [the new act](https://gov-example.example/act) for details.',
      'See [the new for details.',
    ],
    ['see‹https://evil.example› now', 'now'],
    ['Picture ![x](https://evil.example/p.png) here', 'Picture here'],
    ['go to evil[.]example or evil(dot)example', 'go to or'],
    ['open (evil.example) and "www.x"', 'open and'],
    ['get it at 203.0.113.7/law today', 'get it at today'],
    ['visit evil\u3002example or evil\uff0eexample or evil\uff61example', 'visit or or'],
  ])('takes links and hosts out of %s', (note, plain) => {
    expect(plainNote(note)).toBe(plain);
  });

  // A pattern that backtracks on these takes far longer than the test's time limit.
  it.each([`${'a'.repeat(100_000)}:`, `${'a'.repeat(100_000)}!`, `${'0'.repeat(100_000)}x`])(
    'reads a long run quickly',
    (note) => {
      expect(plainNote(note)?.length ?? 0).toBeLessThanOrEqual(300);
    },
  );
});

describe('reportClean', () => {
  const matches = { status: 'matches' as const };
  it.each([
    ['every item matches', [matches, matches], 'claude-sonnet-5-5', true],
    ['an item differs', [matches, { status: 'differs' as const }], 'claude-sonnet-5-5', false],
    ['an item could not be checked', [{ status: 'could_not_check' as const }], 'm', false],
    ['no items', [], 'claude-sonnet-5-5', false],
    ['the scripted checker wrote it', [matches], scriptedCheckerModel, false],
  ])('%s: %s', (_, items, model, clean) => {
    expect(reportClean(items, model)).toBe(clean);
  });
});
