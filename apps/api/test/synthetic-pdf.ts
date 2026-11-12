/**
 * A synthetic PDF for tests and evaluation cases: each page's lines set in a standard font, or a
 * page drawn with no text at all, as a scan is. No real document is ever used. Pages are wide, since
 * pdf.js leaves out text set past a page's edge: a line may run to about 280 characters.
 */
export function syntheticPdf(pages: readonly (readonly string[])[]): Uint8Array {
  const escape = (line: string) => line.replace(/[\\()]/gu, (character) => `\\${character}`);
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  const fontNumber = 3;
  const firstPage = 4;
  add('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, index) => `${String(firstPage + index * 2)} 0 R`).join(' ');
  add(`<< /Type /Pages /Kids [${kids}] /Count ${String(pages.length)} >>`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  for (const [index, lines] of pages.entries()) {
    const content =
      lines.length === 0
        ? '0.5 g 72 72 1456 698 re f'
        : `BT /F1 11 Tf 14 TL 72 760 Td ${lines.map((line) => `(${escape(line)}) Tj T*`).join(' ')} ET`;
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1600 842] /Resources << /Font << /F1 ${String(fontNumber)} 0 R >> >> /Contents ${String(firstPage + index * 2 + 1)} 0 R >>`,
    );
    add(
      `<< /Length ${String(Buffer.byteLength(content, 'latin1'))} >>\nstream\n${content}\nendstream`,
    );
  }
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
