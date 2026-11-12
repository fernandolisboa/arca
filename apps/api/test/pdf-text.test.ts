import { createDeflate } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { pdfText } from '../src/knowledge/check/pdf-text.js';
import { pdfStream, rawPdf, syntheticPdf } from './synthetic-pdf.js';

const font = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
const onePage = (resources: string) => [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
  font,
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> ${resources} >> /Contents 5 0 R >>`,
];

/** Spaces deflated a megabyte at a time, so the test never holds them all. */
async function deflatedSpaces(megabytes: number): Promise<Buffer> {
  const deflate = createDeflate({ level: 9 });
  const chunks: Buffer[] = [];
  deflate.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise((resolve) => deflate.on('end', resolve));
  const megabyte = Buffer.alloc(1024 * 1024, 0x20);
  for (let written = 0; written < megabytes; written += 1) {
    if (!deflate.write(megabyte)) await new Promise((resolve) => deflate.once('drain', resolve));
  }
  deflate.end();
  await done;
  return Buffer.concat(chunks);
}

describe('pdfText, a hostile file (ADR-0028)', () => {
  it('stops a file whose drawing fans out without end at the time limit', async () => {
    const depth = 7;
    const forms = Array.from({ length: depth }, (_, level) =>
      level === depth - 1
        ? pdfStream(
            '/Type /XObject /Subtype /Form /BBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >>',
            Buffer.from('BT /F1 11 Tf 72 760 Td (abc) Tj ET', 'latin1'),
          )
        : pdfStream(
            `/Type /XObject /Subtype /Form /BBox [0 0 600 800] /Resources << /XObject << /X ${String(7 + level)} 0 R >> >>`,
            Buffer.from('/X Do '.repeat(10), 'latin1'),
          ),
    );
    const file = rawPdf([
      ...onePage('/XObject << /X 6 0 R >>'),
      pdfStream('', Buffer.from('/X Do', 'latin1')),
      ...forms,
    ]);
    const started = Date.now();
    expect(await pdfText(file, AbortSignal.timeout(1_000), 3_000_000)).toEqual({
      ok: false,
      failure: 'timeout',
    });
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('stops a file whose stream inflates past the memory bound as too large', async () => {
    const file = rawPdf([
      ...onePage(''),
      pdfStream('/Filter /FlateDecode', await deflatedSpaces(900)),
    ]);
    expect(await pdfText(file, AbortSignal.timeout(30_000), 3_000_000)).toEqual({
      ok: false,
      failure: 'too_large',
    });
  }, 60_000);

  it('reads the same bytes twice, leaving the caller its copy', async () => {
    const file = syntheticPdf([['Residence Act']]);
    const first = await pdfText(file, AbortSignal.timeout(10_000), 3_000_000);
    expect(await pdfText(file, AbortSignal.timeout(10_000), 3_000_000)).toEqual(first);
    expect(first).toEqual({ ok: true, text: 'Residence Act' });
  });

  it('answers timeout at once when the signal has already aborted', async () => {
    expect(await pdfText(syntheticPdf([['Act']]), AbortSignal.abort(), 3_000_000)).toEqual({
      ok: false,
      failure: 'timeout',
    });
  });
});
