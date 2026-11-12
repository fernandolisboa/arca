/**
 * A line of a synthetic page: shown, or hidden from a reader, either drawn invisibly (render mode
 * 3, as a scan's OCR layer is) or in a layer the file switches off.
 */
export type PdfLine =
  string | { readonly text: string; readonly hidden: 'invisible' | 'layer-off' };

/**
 * A synthetic PDF for tests and evaluation cases: each page's lines set in a standard font, or a
 * page drawn with no text at all, as a scan is. No real document is ever used. Pages are wide, since
 * pdf.js leaves out text set past a page's edge: a line may run to about 280 characters.
 */
export function syntheticPdf(pages: readonly (readonly PdfLine[])[]): Uint8Array {
  const escape = (line: string) => line.replace(/[\\()]/gu, (character) => `\\${character}`);
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  const fontNumber = 3;
  const firstPage = 4;
  const layer = firstPage + pages.length * 2;
  const layered = pages.some((lines) =>
    lines.some((line) => typeof line !== 'string' && line.hidden === 'layer-off'),
  );
  add(
    layered
      ? `<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [${String(layer)} 0 R] /D << /OFF [${String(layer)} 0 R] >> >> >>`
      : '<< /Type /Catalog /Pages 2 0 R >>',
  );
  const drawn = (line: PdfLine) => {
    if (typeof line === 'string') return `(${escape(line)}) Tj T*`;
    const shown = `(${escape(line.text)}) Tj T*`;
    return line.hidden === 'invisible' ? `3 Tr ${shown} 0 Tr` : `/OC /L1 BDC ${shown} EMC`;
  };
  const kids = pages.map((_, index) => `${String(firstPage + index * 2)} 0 R`).join(' ');
  add(`<< /Type /Pages /Kids [${kids}] /Count ${String(pages.length)} >>`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  for (const [index, lines] of pages.entries()) {
    const content =
      lines.length === 0
        ? '0.5 g 72 72 1456 698 re f'
        : `BT /F1 11 Tf 14 TL 72 760 Td ${lines.map(drawn).join(' ')} ET`;
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1600 842] /Resources << /Font << /F1 ${String(fontNumber)} 0 R >> /Properties << /L1 ${String(layer)} 0 R >> >> /Contents ${String(firstPage + index * 2 + 1)} 0 R >>`,
    );
    add(
      `<< /Length ${String(Buffer.byteLength(content, 'latin1'))} >>\nstream\n${content}\nendstream`,
    );
  }
  add('<< /Type /OCG /Name (Layer) >>');
  let file = '%PDF-1.7\n';
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(file, 'latin1'));
    file += `${String(index + 1)} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(file, 'latin1');
  file += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  file += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  file += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(file, 'latin1'));
}

/** A PDF of the given object bodies, numbered from 1, the first the catalog, for hostile files. */
export function rawPdf(objects: readonly (string | Buffer)[]): Uint8Array {
  const parts = [Buffer.from('%PDF-1.7\n', 'latin1')];
  let length = parts[0]?.length ?? 0;
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(length);
    const object = Buffer.concat([
      Buffer.from(`${String(index + 1)} 0 obj\n`, 'latin1'),
      typeof body === 'string' ? Buffer.from(body, 'latin1') : body,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    parts.push(object);
    length += object.length;
  }
  const entries = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`);
  parts.push(
    Buffer.from(
      `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n${entries.join('')}trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(length)}\n%%EOF\n`,
      'latin1',
    ),
  );
  return new Uint8Array(Buffer.concat(parts));
}

/** A stream object's body: its dictionary entries, then its data. */
export const pdfStream = (dictionary: string, data: Buffer) =>
  Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${String(data.length)} >>\nstream\n`, 'latin1'),
    data,
    Buffer.from('\nendstream', 'latin1'),
  ]);
