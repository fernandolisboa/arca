import { normalizeWhitespace, statesValue } from '@arca/domain';
import { describe, expect, it } from 'vitest';
import {
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

  it('keeps the words of an inline element on their line, and starts a line after two tags', () => {
    expect(
      lines(
        '<act><title>Act</title><section><num>4</num><p>An income of at least <b>EUR 920</b> a month.</p></section></act>',
      ),
    ).toEqual(['Act', '4', 'An income of at least EUR 920 a month.']);
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
    ).toEqual(['The fee is', 'EUR 85 a year.', 'Old:', 'kept']);
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

  it('reads a page as a page and plain text as it is', () => {
    expect(answerText('html', '<p>Act</p>')).toBe('Act');
    expect(answerText('plain', 'Act <p>')).toBe('Act <p>');
  });
});
