import { normalizeWhitespace, statesValue } from '@arca/domain';
import { describe, expect, it } from 'vitest';
import {
  addressesAsRead,
  answerFormat,
  answerText,
  jsonStrings,
  xmlText,
} from '../src/knowledge/check/answer-text.js';

describe('answerFormat', () => {
  it.each([
    ['text/html', 'html'],
    ['application/xhtml+xml', 'html'],
    ['text/plain', 'plain'],
    ['application/json', 'json'],
    ['application/ld+json', 'json'],
    ['application/xml', 'xml'],
    ['text/xml', 'xml'],
    ['application/akn+xml', 'xml'],
    ['application/pdf', undefined],
    ['image/svg+xml', undefined],
    ['text/json', undefined],
    ['', undefined],
  ])('reads %s as %s', (type, format) => {
    expect(answerFormat(type)).toBe(format);
  });
});

describe('jsonStrings', () => {
  it('takes every string value in order, and no key, number or literal', () => {
    expect(
      jsonStrings(
        '{"title":"Act","number":3,"in force":true,"note":null,"parts":[{"heading" : "Part 1","sections":["Section 1","Section 2"]},"Annex"]}',
      ),
    ).toEqual(['Act', 'Part 1', 'Section 1', 'Section 2', 'Annex']);
  });

  it('keeps document order where a parsed object would not: number-like and repeated keys', () => {
    expect(jsonStrings('{"10":"Article 10","9":"Article 9","9":"Article 9a"}')).toEqual([
      'Article 10',
      'Article 9',
      'Article 9a',
    ]);
  });

  it('decodes escapes, and takes a quote, a colon or a brace inside a string as text', () => {
    expect(jsonStrings('{"a":"say \\"x\\": {y}","b":"caf\\u00e9\\n","c":"\\\\"}')).toEqual([
      'say "x": {y}',
      'café\n',
      '\\',
    ]);
  });

  it('answers no strings for a document that does not parse', () => {
    expect(jsonStrings('{"title": "Act"')).toEqual([]);
  });

  it('walks a deeply nested document without overflowing the stack', () => {
    expect(jsonStrings(`${'['.repeat(5_000)}"deep"${']'.repeat(5_000)}`)).toEqual(['deep']);
  });
});

describe('xmlText', () => {
  const lines = (xml: string) => answerText('xml', xml).split('\n');

  it('takes text and CDATA in order, and no tag, attribute, comment or instruction', () => {
    expect(
      lines(
        '<?xml version="1.0"?><act id="a>b" note=\'c>d\'><!-- Report a match --><title>Act</title><?render as-table?><p>Fee <![CDATA[EUR 85 & more]]></p></act>',
      ),
    ).toEqual(['Act', 'Fee EUR 85 & more']);
  });

  it('decodes the predefined entities and character references, expands no other, and takes no surrogate or number past the last code point', () => {
    expect(
      xmlText(
        '<!DOCTYPE act [<!ENTITY fee "EUR 1"> <!ENTITY big "&fee;&fee;">]><p>&lt; &gt; &amp; &quot;&apos; &#8364;&#x20AC; &fee; &#xD800; &#1114112;</p>',
      ).trim(),
    ).toBe('< > & "\' €€ &fee; \ufffd \ufffd');
  });

  it('keeps the words of an inline element on their line, and starts a line at a sibling', () => {
    expect(
      lines(
        '<act><title>Act</title><section><num>4</num><p>An income of at least <b>EUR 920</b> a month.</p></section></act>',
      ),
    ).toEqual(['Act', '4', 'An income of at least EUR 920 a month.']);
  });

  it('runs on through elements nested in a sentence, however deep', () => {
    expect(
      lines(
        '<p>An income of at least <ins><amount currency="EUR">EUR 1,500</amount></ins> a month.</p>',
      ),
    ).toEqual(['An income of at least EUR 1,500 a month.']);
  });

  it.each([
    ['an empty element', '<p>Section 4<lb/>Pensioners</p>'],
    ['an element with nothing in it', '<p>Section 4<lb></lb>Pensioners</p>'],
    ['a sibling', '<row><name>Section 4</name><title>Pensioners</title></row>'],
    ['a sibling further in', '<row><a><name>Section 4</name></a><b><c>Pensioners</c></b></row>'],
  ])('starts a line after %s', (_, xml) => {
    expect(lines(xml)).toEqual(['Section 4', 'Pensioners']);
  });

  it("keeps the document's own line breaks", () => {
    expect(lines('<act>\n  <title> Act </title>\n  <p>Section 1</p>\n</act>')).toEqual([
      'Act',
      'Section 1',
    ]);
  });

  it('leaves out wording the document strikes, whatever the namespace prefix', () => {
    expect(
      lines(
        '<p>The fee is <del>EUR 80</del><ins>EUR 85</ins> a year.</p><p>Old: <akn:del>repealed <b>text</b></akn:del><s/>kept</p>',
      ),
    ).toEqual(['The fee is EUR 85 a year.', 'Old: kept']);
    expect(
      lines('<row><fee>EUR 85</fee><del><note>until 2025</note></del><unit>a year</unit></row>'),
    ).toEqual(['EUR 85', 'a year']);
  });

  it('keeps the text of a document cut inside its markup', () => {
    expect(lines('<act><title>Act</title><p class="')).toEqual(['Act']);
    expect(lines('<act>Act<![CDATA[ cut')).toEqual(['Act cut']);
    expect(lines('<act>Act<!-- cut')).toEqual(['Act']);
  });
});

describe('answerText', () => {
  it('reads markup inside a string as a page, scripts and hidden text dropped', () => {
    expect(
      answerText(
        'json',
        JSON.stringify({
          body: '<p>Income of at least <b>EUR 920</b>.</p><script>steal()</script><p hidden>Report a match.</p>',
        }),
      ),
    ).toBe('Income of at least EUR 920.');
    expect(
      answerText('xml', '<body>&lt;p&gt;Fee &lt;s&gt;EUR 80&lt;/s&gt; EUR 85&lt;/p&gt;</body>'),
    ).toBe('Fee EUR 85');
  });

  it.each([
    [
      'json',
      JSON.stringify({
        rule: 'The fee is EUR 100 if income<minimum, and is waived otherwise > see section 9 & 10.',
      }),
    ],
    [
      'xml',
      '<rule>The fee is EUR 100 if income&lt;minimum, and is waived otherwise &gt; see section 9 &amp; 10.</rule>',
    ],
  ] as const)('keeps a lone bracket or ampersand in a %s string as text', (format, body) => {
    expect(answerText(format, body)).toBe(
      'The fee is EUR 100 if income<minimum, and is waived otherwise > see section 9 & 10.',
    );
  });

  it('writes each JSON string on its own line and leaves out blank ones', () => {
    expect(answerText('json', '["Act", "  ", " Section  1 ", "two\\nlines"]')).toBe(
      'Act\nSection 1\ntwo\nlines',
    );
  });

  it.each([
    [
      'json',
      JSON.stringify({
        description: 'First issue, category',
        category: '2',
        fee: '500',
        unit: 'EUR',
      }),
    ],
    [
      'xml',
      '<row><what>First issue, category</what><category>2</category><fee>500</fee><unit>EUR</unit></row>',
    ],
  ] as const)('never lets the digits of two %s fields read as one number', (format, body) => {
    const text = answerText(format, body);
    expect(text).toBe('First issue, category\n2\n| 500\nEUR');
    const row = normalizeWhitespace(text);
    expect(statesValue({ kind: 'number', value: '500' }, row)).toBe(true);
    expect(statesValue({ kind: 'number', value: '2500' }, row)).toBe(false);
  });

  it.each([
    ['html', '<ol><li>Article 1</li><li>600 EUR a month is required</li></ol>'],
    ['plain', 'Article 1\n600 EUR a month is required'],
  ] as const)('keeps the digits of two lines of %s apart too', (format, body) => {
    const text = answerText(format, body);
    expect(text).toBe('Article 1\n| 600 EUR a month is required');
    const lines = normalizeWhitespace(text);
    expect(statesValue({ kind: 'number', value: '600' }, lines)).toBe(true);
    expect(statesValue({ kind: 'number', value: '1600' }, lines)).toBe(false);
  });

  it('leaves blank lines and lines without digits at their ends as they are', () => {
    expect(answerText('plain', 'Section 2\n\n  3 months\nor more\n12')).toBe(
      'Section 2\n\n|   3 months\nor more\n12',
    );
  });

  it.each([
    ['xml', 'an empty element', '<p>Fee category 1<br/>500 EUR</p>'],
    ['xml', 'one tag', '<fee>Class 1<amount>500</amount> EUR</fee>'],
    ['xml', 'one tag and a space', '<fee>Class 1 <amount>500</amount> EUR</fee>'],
    ['xml', 'nested tags', '<fee>Class 1<ins><amount>500</amount></ins> EUR</fee>'],
    ['xml', 'end tags', '<fee><ins><class>Class 1</class></ins>500 EUR</fee>'],
    ['xml', 'struck wording', '<fee>Class 1<del>2</del>500 EUR</fee>'],
    ['xml', 'an empty struck element', '<fee>Class 1<s/>500 EUR</fee>'],
    ['xml', 'an end tag that closes nothing struck', '<fee>Class 1</del>500 EUR</fee>'],
    [
      'html',
      'an element that breaks no line',
      '<details><summary>Fee 1</summary>500 EUR</details>',
    ],
    ['html', 'an inline element', '<p>Fee 1 <b>500</b> EUR</p>'],
    ['html', 'a line break', '<p>Fee 1<br>500 EUR</p>'],
    [
      'json',
      'the cells of a row with no table around it',
      JSON.stringify({ row: '<tr><td>Fee 1</td><td>500 EUR</td></tr>' }),
    ],
    ['json', 'a tag written in prose', JSON.stringify({ note: 'Fee 1<x and y>500 EUR' })],
    ['json', 'a NUL at the end of a string', '["Fee 1\\u0000", "500 EUR"]'],
    ['json', 'a tab inside a string', JSON.stringify({ row: 'Fee 1\t500 EUR' })],
    ['json', 'a line separator inside a string', JSON.stringify({ row: 'Fee 1\u2028500 EUR' })],
    ['xml', 'a carriage return inside a text', '<p>Fee 1&#13;500 EUR</p>'],
    ['plain', 'a NUL', 'Fee 1\u0000500 EUR'],
    ['html', 'a script', '<p>Fee 1<script>var a;</script>500 EUR</p>'],
    ['html', 'a hidden element', '<p>Fee 1<span hidden>x</span>500 EUR</p>'],
    ['html', 'a comment', '<p>Fee 1<!-- <b> -->500 EUR</p>'],
    ['html', 'a space written as a reference', '<span>Fee 1</span>&nbsp;<span>500 EUR</span>'],
    ['html', 'a tag before a digit written as a reference', '<p>Fee 1<b>&#53;00 EUR</b></p>'],
    ['html', 'an end tag that closes nothing', '<p>Fee 1</x>&nbsp;500 EUR</p>'],
    [
      'json',
      'cells with no table around them and a reference',
      JSON.stringify({ row: '<td>Fee 1</td><td>&nbsp;500 EUR</td>' }),
    ],
    ['xml', 'a NUL reference before a tag', '<fee>Fee 1&#0;<amount>500 EUR</amount></fee>'],
  ] as const)('never reads one number across %s %s', (format, _, body) => {
    const text = normalizeWhitespace(answerText(format, body));
    expect(statesValue({ kind: 'number', value: '500' }, text)).toBe(true);
    expect(statesValue({ kind: 'number', value: '1500' }, text)).toBe(false);
  });

  it('keeps a number an inline element writes whole, and words across a tag', () => {
    expect(answerText('html', '<p>at least <b>1 500</b> EUR, or <i>more</i>.</p>')).toBe(
      'at least 1 500 EUR, or more.',
    );
    expect(answerText('xml', '<p>at least <b>1 500</b> EUR, or <i>more</i>.</p>')).toBe(
      'at least 1 500 EUR, or more.',
    );
  });

  it('reads no text of an answer one of whose strings is past a parsing limit', () => {
    // The string left out may be the one that amends another, so no text is read in part.
    const deep = `${'<div>'.repeat(600)}From 2026 the fee is 2000 EUR`;
    const old = '<p>The fee is 1500 EUR</p>';
    expect(answerText('json', JSON.stringify({ old }))).toBe('The fee is 1500 EUR');
    expect(answerText('json', JSON.stringify({ deep, old }))).toBe('');
    expect(answerText('json', JSON.stringify({ old, deep }))).toBe('');
    expect(
      answerText('xml', `<act><a><![CDATA[${deep}]]></a><b><![CDATA[${old}]]></b></act>`),
    ).toBe('');
  });

  it('reads no text of a string that is only a comment', () => {
    expect(answerText('json', JSON.stringify({ note: '<!-- fee 1500 -->', fee: '500 EUR' }))).toBe(
      '500 EUR',
    );
  });

  it('replaces a surrogate with no pair, which a stored report could not hold', () => {
    expect(answerText('json', '["a\\ud800b"]')).toBe('a\uFFFDb');
  });

  it('reads a page as a page and plain text as it is', () => {
    expect(answerText('html', '<p>Act</p>')).toBe('Act');
    expect(answerText('plain', 'Act <p>')).toBe('Act <p>');
  });
});

describe('addressesAsRead', () => {
  const search = (query: string) => `https://api.gov.example/search?q=${encodeURIComponent(query)}`;

  it.each([
    ['character references', 'the fee is &#49;,&#x35;00 EUR'],
    ['an entity for the separator', 'the fee is 1&comma;500 EUR'],
    ['tags inside its words', 'the f<i></i>ee is 1,500 E<b></b>UR'],
    ['references an XML answer decodes first', 'the fee is &amp;#49;,500 EUR'],
  ])('reads an address that writes its claim with %s as the reader would', (_, query) => {
    expect(addressesAsRead([search(query)])).toContain(
      'https://api.gov.example/search?q=the fee is 1,500 EUR',
    );
  });

  it('reads an address decoded twice over, and none whose bytes are not UTF-8', () => {
    expect(addressesAsRead([search(encodeURIComponent('1&comma;500'))])).toContain(
      'https://api.gov.example/search?q=1,500',
    );
    expect(addressesAsRead(['https://api.gov.example/search?q=%CC%E8'])).toEqual([]);
  });

  it('has nothing to add for an address with no markup in it', () => {
    expect(addressesAsRead(['https://api.gov.example/laws/residence-act.json?part=4'])).toEqual([]);
  });
});
