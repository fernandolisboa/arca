import { describe, expect, it } from 'vitest';
import {
  type CheckAnswer,
  type ReadPage,
  plainNote,
  reportClean,
  countStatuses,
  reportPoints,
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
  citations: [{ url: law, title: 'Residence act, article 3' }],
};

const page = (patch: Partial<ReadPage> = {}): ReadPage => ({
  url: law,
  text: 'Article 3.\nThe applicant shows a monthly income of at least\n€920,00 for the principal.',
  cut: false,
  chain: [law],
  ...patch,
});

const quote = 'a monthly income of at least €920,00';

/** A claim no law makes, and a search address that carries a text for its API to write back. */
const claim = 'spouses of any age are granted a permit';
const searching = (text: string) => `https://api.gov.example/search?q=${encodeURIComponent(text)}`;
const asReferences = (text: string) =>
  text.replace(/./gsu, (char) => `&#${String(char.codePointAt(0))};`);

const asLegacyEscapes = (text: string) =>
  text.replace(/./gsu, (char) => `%u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
/** A sentence that shares one word with a query, far less than half of it. */
const sponsored = 'A sponsor is required for a spouse of any age under this article';

/** An answer's quotes: one passage on one page. */
const on = (text: string, url = law) => ({ quotes: [{ quote: text, url }] });

function verify(answer: Partial<CheckAnswer> | undefined, read: ReadPage | null = page()) {
  const answers =
    answer === undefined ? [] : [{ key: item.key, status: 'matches' as const, ...answer }];
  const pages = new Map(read === null ? [] : [[read.url, read]]);
  const [checked] = verifyAnswers([item], answers, pages);
  return checked;
}

describe('verifyAnswers', () => {
  it('takes a match whose quote is on the page and states the value', () => {
    expect(verify(on(quote))).toEqual({
      key: item.key,
      status: 'matches',
      quotes: [{ quote, url: law }],
      note: null,
      reason: null,
    });
  });

  it.each<[string, Partial<CheckAnswer> | undefined, ReadPage | null, string]>([
    ['no answer', undefined, page(), 'not_answered'],
    ['the model could not check', { status: 'could_not_check' }, page(), 'model_could_not_check'],
    ['a URL the item does not cite', on(quote, other), page(), 'url_not_cited'],
    ['an empty URL', on(quote, ''), page(), 'url_not_cited'],
    ['no quote', { quotes: [] }, page(), 'quote_count'],
    ['no quotes at all', {}, page(), 'quote_count'],
    [
      'four quotes',
      { quotes: Array.from({ length: 4 }, () => ({ quote, url: law })) },
      page(),
      'quote_count',
    ],
    ['an item none of whose pages was read', on(quote), null, 'no_page_read'],
    ['no answer and no page read', undefined, null, 'no_page_read'],
    [
      'a quote across the gap of an excerpt',
      on('Article 3. […] €920,00 for the principal.'),
      page({ excerpt: true, text: 'Article 3.\n[…]\n€920,00 for the principal.' }),
      'quote_not_on_page',
    ],
    [
      'a quote that runs into the gap of an excerpt',
      on('at least €920,00 for the principal. […'),
      page({ excerpt: true, text: `${page().text}\n[…]\nArticle 9. Fees` }),
      'quote_not_on_page',
    ],
    ['a quote too short', on('€920,00'), page(), 'quote_length'],
    ['a quote too long', on('x'.repeat(801)), page(), 'quote_length'],
    [
      'a quote not on the page',
      on('a monthly income of at least €720,00'),
      page(),
      'quote_not_on_page',
    ],
    ['a match from a cut page', on(quote), page({ cut: true }), 'page_cut'],
    [
      'a match without the value',
      on('Article 3. The applicant shows'),
      page(),
      'value_not_in_quote',
    ],
    [
      'a quote holding a query value of the chain',
      on('search results for ninehundred twenty'),
      page({
        text: 'search results for ninehundred twenty euros',
        chain: [law, 'https://www.gov.example/search?q=ninehundred'],
      }),
      'echoes_address',
    ],
    [
      'a quote that is part of a long query value of the chain',
      on('spouses of any age are granted a permit'),
      page({
        text: 'It is hereby confirmed that spouses of any age are granted a permit of the same duration.',
        chain: [
          'https://api.gov.example/search?q=It+is+hereby+confirmed+that+spouses+of+any+age+are+granted+a+permit+of+the+same+duration.',
        ],
      }),
      'echoes_address',
    ],
    [
      'a claim a query spells as character references',
      on(claim),
      page({ text: claim, chain: [searching(asReferences(claim))] }),
      'echoes_address',
    ],
    [
      'a claim a query writes between tags',
      on(claim),
      page({ text: claim, chain: [searching(claim.replaceAll('a', 'a<i></i>'))] }),
      'echoes_address',
    ],
    [
      'a claim after a number sign the query carries encoded',
      on(claim),
      page({ text: `x#${claim}`, chain: [searching(`x#${claim}`)] }),
      'echoes_address',
    ],
    [
      'a claim in a query that follows an encoded number sign',
      on(claim),
      page({
        text: claim,
        chain: [`https://api.gov.example/search?tag=%23residence&q=${encodeURIComponent(claim)}`],
      }),
      'echoes_address',
    ],
    [
      'a difference a query carries after an encoded number sign',
      { status: 'differs', ...on(claim) },
      page({ text: claim, chain: [searching(`#${claim}`)] }),
      'echoes_address',
    ],
    [
      'a claim a query spells as JSON escapes',
      on(claim),
      page({ text: claim, chain: [searching(claim.replaceAll('s', '\\u0073'))] }),
      'echoes_address',
    ],
    [
      'an address encoded more times over than it is decoded here',
      on(quote),
      page({
        chain: [
          law,
          `https://www.gov.example/amounts?v=${[1, 2, 3, 4].reduce(encodeURIComponent, '%39%32%30')}`,
        ],
      }),
      'echoes_address',
    ],
    [
      'a value an address states under bytes that stop a later decoding',
      on(quote),
      page({ chain: [law, 'https://www.gov.example/amounts?v=%2539%2532%2530&w=%25FF'] }),
      'echoes_address',
    ],
    [
      'a value an address states in one run with bytes that stop a later decoding',
      on(quote),
      page({ chain: [law, 'https://www.gov.example/amounts?v=%2539%2532%2530%25FF'] }),
      'echoes_address',
    ],
    [
      'a claim a query spells as the escapes of a legacy server',
      on(claim),
      page({
        text: claim,
        chain: [`https://api.gov.example/search.aspx?q=${asLegacyEscapes(claim)}`],
      }),
      'echoes_address',
    ],
    [
      'a legacy escape that only a second decoding shows',
      on(quote),
      page({ chain: [law, 'https://www.gov.example/amounts?v=%25u0039%25u0032%25u0030'] }),
      'echoes_address',
    ],
    ...['\t', '\n', '\r', '\u0001'].map(
      (dropped): [string, Partial<CheckAnswer>, ReadPage, string] => [
        `a claim an address spells around a character dropped when it is sent (${JSON.stringify(dropped)})`,
        on(claim),
        page({
          text: claim,
          chain: [
            `https://api.gov.example/search?q=${claim.replace(
              /./gsu,
              (char) => `%${dropped}${char.charCodeAt(0).toString(16)}`,
            )}`,
          ],
        }),
        'echoes_address',
      ],
    ),
    [
      'an address with a space at an end, which is trimmed when it is sent',
      on(quote),
      page({ chain: [`${law} `] }),
      'echoes_address',
    ],
    [
      'a word a query carries before a semicolon',
      on(sponsored),
      page({ text: sponsored, chain: ['https://api.gov.example/search?status=required;x=1'] }),
      'echoes_address',
    ],
    [
      'a whole query value of short pieces between semicolons',
      on(`Search results for: no;fee;is;due. ${sponsored}`),
      page({
        text: `Search results for: no;fee;is;due. ${sponsored}`,
        chain: ['https://api.gov.example/search?q=no;fee;is;due'],
      }),
      'echoes_address',
    ],
    [
      'a word a query carries before an encoded number sign',
      on(sponsored),
      page({ text: sponsored, chain: ['https://api.gov.example/search?status=required%23x'] }),
      'echoes_address',
    ],
    [
      'a word a query carries before a fragment',
      on(sponsored),
      page({ text: sponsored, chain: ['https://api.gov.example/search?status=required#x'] }),
      'echoes_address',
    ],
    [
      'an address whose bytes are not UTF-8',
      on(quote),
      page({ chain: [law, 'https://www.gov.example/search?q=%CC%E8%ED'] }),
      'echoes_address',
    ],
    [
      'a value an address states once it is decoded twice',
      on(quote),
      page({ chain: [law, 'https://www.gov.example/amounts?v=%2539%2532%2530'] }),
      'echoes_address',
    ],
    [
      'a quote put together from several short query values of the chain',
      on('spouses of any age qualify'),
      page({
        text: 'spouses\nof any age\nqualify',
        chain: ['https://api.gov.example/echo?a=spouses&b=of%20any%20age&c=qualify'],
      }),
      'echoes_address',
    ],
    [
      'a value the address already states',
      on(quote),
      page({ chain: [law, 'https://www.gov.example/amounts/920'] }),
      'echoes_address',
    ],
    [
      'a difference from a page whose address states the value',
      { status: 'differs', ...on(quote) },
      page({ chain: [law, 'https://www.gov.example/amounts/920'] }),
      'echoes_address',
    ],
  ])('makes %s could not be checked', (_, answer, read, reason) => {
    expect(verify(answer, read)).toMatchObject({
      status: 'could_not_check',
      quotes: [],
      note: null,
      reason,
    });
  });

  it("takes a quote that restates the words of its page's path", () => {
    const text =
      'A long-term residence permit for the purpose of family reunification needs a monthly income of at least €920,00';
    const read = page({
      text,
      chain: [
        'https://www.gov.example/permits/long-term-residence-permit-for-the-purpose-of-family-reunification/',
      ],
    });
    expect(verify(on(text), read)).toMatchObject({ status: 'matches' });
  });

  it('takes a quote from a page whose address has a stray percent sign or a query of IDs', () => {
    const chain = [law, 'https://www.gov.example/act?id=BOE-A-2000-544&rate=5%&p=%C3%A9'];
    expect(verify(on(quote), page({ chain }))).toMatchObject({ status: 'matches' });
  });

  it('leaves the fragment of an address, which is never sent, out of what it says', () => {
    const text = 'Financial requirement: a monthly income of at least €920,00';
    const chain = ['https://www.gov.example/visas?lang=en#financial-requirement-monthly-income'];
    expect(verify(on(text), page({ text, chain }))).toMatchObject({ status: 'matches' });
  });

  it("takes the reader's rendering of an address as the address", () => {
    const amount: CheckItem = { ...item, values: [{ kind: 'number', value: '1500' }] };
    const stated = 'A monthly income of 1,500 is required';
    const chain = ['https://api.gov.example/search?q=income+1%26comma%3B500'];
    const check = (echoes: readonly string[]) =>
      verifyAnswers(
        [amount],
        [{ key: item.key, status: 'matches', ...on(stated) }],
        new Map([[law, page({ text: stated, chain, echoes })]]),
      )[0];
    // The address spells the comma as an entity, so only the text a reader of markup makes of it
    // states the amount.
    expect(check([])).toMatchObject({ status: 'matches' });
    expect(check(['https://api.gov.example/search?q=income 1,500'])).toMatchObject({
      status: 'could_not_check',
      reason: 'echoes_address',
    });
  });

  it('takes a quote that shares only a word or two with its address', () => {
    const read = page({
      text: 'Residence act, article 3. The applicant shows a monthly income of at least €920,00.',
      chain: ['https://api.gov.example/laws/residence-act/article-3.json'],
    });
    const sharing =
      'Residence act, article 3. The applicant shows a monthly income of at least €920,00';
    expect(verify(on(sharing), read)).toMatchObject({ status: 'matches' });
  });

  it('names the page that was not read when another page of the item was', () => {
    const both = { ...item, urls: [law, other] };
    const [checked] = verifyAnswers(
      [both],
      [{ key: item.key, status: 'matches', ...on(quote, other) }],
      new Map([[law, page()]]),
    );
    expect(checked).toMatchObject({ status: 'could_not_check', reason: 'page_not_read' });
  });

  it('says an item cites no official page before anything else', () => {
    const [checked] = verifyAnswers(
      [{ ...item, urls: [] }],
      [{ key: item.key, status: 'matches', ...on(quote) }],
      new Map([[law, page()]]),
    );
    expect(checked).toMatchObject({ status: 'could_not_check', reason: 'no_source_cited' });
  });

  it("keeps the model's own reason, as a plain note, when it could not check", () => {
    expect(
      verify({
        status: 'could_not_check',
        note: 'A página recebida é um aviso de acesso, veja https://evil.example, não a lei.',
      }),
    ).toEqual({
      key: item.key,
      status: 'could_not_check',
      quotes: [],
      note: 'A página recebida é um aviso de acesso, veja não a lei.',
      reason: 'model_could_not_check',
    });
  });

  it('drops a note on an answer that code refused', () => {
    expect(verify({ ...on('x'.repeat(801)), note: 'Trust this one.' })).toMatchObject({
      reason: 'quote_length',
      note: null,
    });
  });

  it('normalizes whitespace on both sides, line breaks included', () => {
    expect(verify(on('monthly income of at least\n\n  €920,00   for'))).toMatchObject({
      status: 'matches',
      quotes: [{ quote: 'monthly income of at least €920,00 for', url: law }],
    });
  });

  it.each([
    ['a figure', 'stay of 22 months in the country.', '2 months in the country.', '2'],
    [
      'words',
      'permanecer vinte e dois meses em território nacional.',
      'dois meses em território nacional',
      '2',
    ],
    ['kanji', '在留期間は十二年を超えない範囲で定める。', '二年を超えない範囲で定める。', '2'],
    [
      'a grouped figure',
      'a monthly income of 1.500 EUR is required.',
      '500 EUR is required.',
      '500',
    ],
    [
      'a decimal',
      'permanecer por 2,5 anos em território nacional.',
      '5 anos em território nacional',
      '5',
    ],
    [
      'a kanji ordinal',
      '在留期間は第十二年を超えない範囲で定める。',
      '十二年を超えない範囲で定める。',
      '12',
    ],
    [
      'an en dash',
      'a stay of twenty–two months in the country.',
      'two months in the country.',
      '2',
    ],
  ])('reads a quote cut out of a number in %s as the whole number', (_, text, cut, value) => {
    const two = { ...item, values: [{ kind: 'number' as const, value }] };
    const [checked] = verifyAnswers(
      [two],
      [{ key: two.key, status: 'matches', ...on(cut) }],
      new Map([[law, page({ text })]]),
      ['pt', 'ja', 'en'],
    );
    expect(checked).toMatchObject({ status: 'could_not_check', reason: 'value_not_in_quote' });
  });

  it('keeps a quote widened to the whole words it was cut from', () => {
    expect(verify(on('onthly income of at least €920,00 for th'))).toMatchObject({
      status: 'matches',
      quotes: [{ quote: 'monthly income of at least €920,00 for the', url: law }],
    });
  });

  it('takes a difference with its quote and a plain note, without the value check', () => {
    expect(
      verify({
        status: 'differs',
        ...on('a monthly income of at least €920,00'),
        note: 'The page asks for 920, see https://evil.example and www.evil.example; the rule <b>says</b> 820.',
      }),
    ).toEqual({
      key: item.key,
      status: 'differs',
      quotes: [{ quote: 'a monthly income of at least €920,00', url: law }],
      note: 'The page asks for 920, see and the rule b says /b 820.',
      reason: null,
    });
  });

  it('keeps a difference from a cut page', () => {
    expect(verify({ status: 'differs', ...on(quote) }, page({ cut: true }))).toMatchObject({
      status: 'differs',
    });
  });

  it('drops keys of no item and every answer of a key answered twice', () => {
    const answer = { key: item.key, status: 'matches' as const, ...on(quote) };
    const pages = new Map([[law, page()]]);
    expect(verifyAnswers([item], [answer, answer], pages)[0]?.reason).toBe('not_answered');
    expect(
      verifyAnswers([item], [answer, { ...answer, key: 'requirement:ghost' }], pages),
    ).toHaveLength(1);
  });
});

describe('a match on several quotes', () => {
  const fees = 'https://www.gov.example/fees';
  const both: CheckItem = {
    ...item,
    urls: [law, fees],
    values: [
      { kind: 'number', value: '920' },
      { kind: 'number', value: '460' },
    ],
  };
  const lawPage = page({
    text: 'Article 3.\nThe principal shows a monthly income of at least €920,00.\nArticle 4.\nEach dependant adds €460,00 a month to that income.',
  });
  const feesPage = page({
    url: fees,
    chain: [fees],
    text: 'Fees.\nEach dependant adds €460,00 a month to the income of the principal.',
  });
  const principal = { quote: 'a monthly income of at least €920,00', url: law };
  const dependant = { quote: 'Each dependant adds €460,00 a month', url: law };
  const check = (
    quotes: readonly { quote: string; url: string }[],
    status: 'matches' | 'differs' = 'matches',
    pages: readonly ReadPage[] = [lawPage, feesPage],
  ) =>
    verifyAnswers(
      [both],
      [{ key: both.key, status, quotes }],
      new Map(pages.map((read) => [read.url, read])),
    )[0];

  it('takes two quotes on one page that state the values between them', () => {
    expect(check([principal, dependant])).toEqual({
      key: both.key,
      status: 'matches',
      quotes: [principal, dependant],
      note: null,
      reason: null,
    });
  });

  it('takes two quotes on two pages the item cites', () => {
    const elsewhere = { quote: 'Each dependant adds €460,00 a month to the income', url: fees };
    expect(check([principal, elsewhere])).toMatchObject({
      status: 'matches',
      quotes: [principal, elsewhere],
    });
  });

  it('takes three quotes and refuses a fourth', () => {
    const third = { quote: 'Article 4. Each dependant adds', url: law };
    expect(check([principal, dependant, third])?.status).toBe('matches');
    expect(check([principal, dependant, third, principal])).toMatchObject({
      status: 'could_not_check',
      quotes: [],
      reason: 'quote_count',
    });
  });

  it('needs every value in some quote', () => {
    expect(check([principal])?.reason).toBe('value_not_in_quote');
  });

  it.each<[string, { quote: string; url: string }, string]>([
    [
      'a quote not on its page',
      { quote: 'Each dependant adds €560,00 a month', url: law },
      'quote_not_on_page',
    ],
    ['a page the item does not cite', { ...dependant, url: other }, 'url_not_cited'],
    [
      'a page that was not read',
      { quote: 'Each dependant adds €460,00 a month', url: fees },
      'page_not_read',
    ],
    ['a quote too short', { quote: '€460,00', url: law }, 'quote_length'],
  ])('refuses the whole item over %s', (_, second, reason) => {
    const pages = reason === 'page_not_read' ? [lawPage] : [lawPage, feesPage];
    expect(check([principal, second], 'matches', pages)).toMatchObject({
      status: 'could_not_check',
      quotes: [],
      reason,
    });
  });

  it("refuses a match when one quote's page was cut, but keeps a difference", () => {
    const cutFees = { ...feesPage, cut: true };
    const elsewhere = { quote: 'Each dependant adds €460,00 a month', url: fees };
    expect(check([principal, elsewhere], 'matches', [lawPage, cutFees])?.reason).toBe('page_cut');
    expect(check([principal, elsewhere], 'differs', [lawPage, cutFees])?.status).toBe('differs');
  });

  it("checks each quote against its own page's address", () => {
    const echoing = { ...feesPage, chain: [fees, 'https://www.gov.example/fees?q=dependant+adds'] };
    const elsewhere = { quote: 'Each dependant adds €460,00 a month', url: fees };
    expect(check([principal, elsewhere], 'matches', [lawPage, echoing])?.reason).toBe(
      'echoes_address',
    );
  });
});

describe('a quote on an excerpt', () => {
  it('counts within one run', () => {
    const excerpt = page({ excerpt: true, text: `Article 1.\n[…]\n${page().text}\n[…]` });
    expect(verify(on(quote), excerpt)).toMatchObject({ status: 'matches' });
  });

  it("counts on a whole page that writes the gap's characters itself", () => {
    const text = 'The applicant […] shows a monthly income of at least €920,00.';
    expect(verify(on(text), page({ text }))).toMatchObject({
      status: 'matches',
    });
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
    ['Escreva para fulano@ministerio agora', 'Escreva para agora'],
    ['Veja пример.рф para confirmar', 'Veja para confirmar'],
    ['Veja evil\u200B.example para confirmar', 'Veja para confirmar'],
    ['Veja evil\u00ADsite.example para confirmar', 'Veja para confirmar'],
    ['Veja evil\uFE0Fsite\u034F.example\u2800 para confirmar', 'Veja para confirmar'],
    [
      'A seção 4 não traz o valor; o art. 3.º cita 1.500.',
      'A seção 4 não traz o valor; o art. 3.º cita 1.500.',
    ],
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

describe('reportPoints', () => {
  const counts = { matches: 3, differs: 1, could_not_check: 2 };
  it('counts a model report as it came out', () => {
    expect(reportPoints(counts, 'claude-sonnet-5-5')).toEqual({
      matches: 3,
      differs: 1,
      unread: 2,
    });
  });
  it('never counts a scripted match as confirmed', () => {
    expect(reportPoints(counts, scriptedCheckerModel)).toEqual({
      matches: 0,
      differs: 1,
      unread: 5,
    });
  });
});

describe('countStatuses', () => {
  it('counts each status, none of them missing', () => {
    expect(
      countStatuses([{ status: 'matches' }, { status: 'matches' }, { status: 'differs' }]),
    ).toEqual({ matches: 2, differs: 1, could_not_check: 0 });
  });
});
