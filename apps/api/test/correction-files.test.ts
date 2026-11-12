import { describe, expect, it } from 'vitest';
import { fitsFileType } from '../src/knowledge/correction-files.js';

const bytes = (text: string) => Buffer.from(text, 'latin1');

// The type check on a filed file's first bytes (ADR-0029). Synthetic content only.
describe('fitsFileType', () => {
  it.each<[string, Parameters<typeof fitsFileType>[0], Buffer, boolean]>([
    ['a PDF', 'application/pdf', bytes('%PDF-1.7\n1 0 obj'), true],
    ['text declared a PDF', 'application/pdf', bytes('Art. 1.º'), false],
    ['HTML with a doctype', 'text/html', bytes('\n  <!DOCTYPE html><html lang="pt">'), true],
    ['HTML after a byte order mark', 'text/html', bytes('ï»¿<html><head>'), true],
    ['HTML opening with a comment', 'text/html', bytes('<!-- saved page --><html>'), true],
    ['plain text declared HTML', 'text/html', bytes('Art. 1.º O valor'), false],
    ['a PDF declared HTML', 'text/html', bytes('%PDF-1.7\n'), false],
    ['UTF-8 text', 'text/plain', Buffer.from('Art. 1.º O valor é R$ 900,00.\r\n', 'utf8'), true],
    ['Latin-1 text', 'text/plain', bytes('Artigo 1.º\tvalor\f'), true],
    [
      'a binary file declared text',
      'text/plain',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]),
      false,
    ],
    ['a PDF declared text', 'text/plain', bytes('%PDF-1.4\n'), false],
  ])('%s', (_label, mediaType, head, fits) => {
    expect(fitsFileType(mediaType, head)).toBe(fits);
  });
});
