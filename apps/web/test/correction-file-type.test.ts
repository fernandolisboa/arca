import { describe, expect, it } from 'vitest';
import { correctionFileType } from '../src/knowledge/correction-file-type.js';

// Which chosen files a correction request takes, and as what type (ADR-0029).
describe('correctionFileType', () => {
  it.each<[string, { name: string; type: string; size: number }, string | undefined]>([
    ['a PDF', { name: 'lei.pdf', type: 'application/pdf', size: 1000 }, 'application/pdf'],
    [
      'HTML with a charset',
      { name: 'p.html', type: 'text/html; charset=utf-8', size: 9 },
      'text/html',
    ],
    ['text with no browser type', { name: 'nota.TXT', type: '', size: 9 }, 'text/plain'],
    [
      'an .htm the browser calls a byte stream',
      { name: 'p.htm', type: 'application/octet-stream', size: 9 },
      'text/html',
    ],
    ['an image', { name: 'foto.png', type: 'image/png', size: 9 }, undefined],
    ['an image named .pdf', { name: 'foto.pdf', type: 'image/png', size: 9 }, undefined],
    ['an empty file', { name: 'vazio.txt', type: 'text/plain', size: 0 }, undefined],
    [
      'a file over 16 MB',
      { name: 'grande.pdf', type: 'application/pdf', size: 16 * 1024 * 1024 + 1 },
      undefined,
    ],
  ])('%s', (_label, file, type) => {
    expect(correctionFileType(file)).toBe(type);
  });
});
