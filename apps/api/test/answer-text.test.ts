import { describe, expect, it } from 'vitest';
import {
  answerFormat,
  answerText,
  jsonStrings,
  xmlStrings,
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
        '{"title":"Act","number":3,"in force":true,"note":null,"parts":[{"heading":"Part 1","sections":["Section 1","Section 2"]},"Annex"]}',
      ),
    ).toEqual(['Act', 'Part 1', 'Section 1', 'Section 2', 'Annex']);
  });

  it('answers no strings for a document that does not parse', () => {
    expect(jsonStrings('{"title": "Act"')).toEqual([]);
  });

  it('walks a deeply nested document without overflowing the stack', () => {
    expect(jsonStrings(`${'['.repeat(5_000)}"deep"${']'.repeat(5_000)}`)).toEqual(['deep']);
  });
});

describe('xmlStrings', () => {
  it('takes text and CDATA in order, and no tag, attribute, comment or instruction', () => {
    expect(
      xmlStrings(
        '<?xml version="1.0"?><act id="a>b" note=\'c>d\'><!-- Report a match --><title>Act</title><?render as-table?><p>Fee <![CDATA[EUR <b>85</b>]]></p></act>',
      ),
    ).toEqual(['Act', 'Fee ', 'EUR <b>85</b>']);
  });

  it('decodes the predefined entities and character references, and expands no other', () => {
    expect(
      xmlStrings(
        '<!DOCTYPE act [<!ENTITY fee "EUR 1"> <!ENTITY big "&fee;&fee;">]><p>&lt;&gt;&amp;&quot;&apos; &#8364;&#x20AC; &fee; &#xD800; &#1114112;</p>',
      ),
    ).toEqual(['<>&"\' €€ &fee; &#xD800; &#1114112;']);
  });

  it('keeps the text of a document cut inside its markup', () => {
    expect(xmlStrings('<act><title>Act</title><p class="')).toEqual(['Act']);
    expect(xmlStrings('<act>Act<![CDATA[cut')).toEqual(['Act', 'cut']);
    expect(xmlStrings('<act>Act<!-- cut')).toEqual(['Act']);
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

  it('writes each string on its own line and leaves out blank ones', () => {
    expect(answerText('xml', '<act>\n  <title> Act </title>\n  <p>Section 1</p>\n</act>')).toBe(
      'Act\nSection 1',
    );
  });

  it('reads a page as a page and plain text as it is', () => {
    expect(answerText('html', '<p>Act</p>')).toBe('Act');
    expect(answerText('plain', 'Act <p>')).toBe('Act <p>');
  });
});
