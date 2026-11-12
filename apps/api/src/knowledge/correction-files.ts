import type { CorrectionFileType } from '@arca/api-contract/routes';

/** Bytes no text file holds, as the WHATWG MIME Sniffing standard's "binary data byte" says. */
const binaryByte = (byte: number) =>
  byte <= 0x08 || byte === 0x0b || (byte >= 0x0e && byte <= 0x1a) || (byte >= 0x1c && byte <= 0x1f);

const isText = (head: Buffer) => !head.some(binaryByte);

/** How an HTML file may begin, after a byte order mark and white space, in any case. */
const htmlStarts = ['<!doctype html', '<html', '<head', '<body', '<meta', '<title', '<!--'];

function looksLikeHtml(head: Buffer): boolean {
  const start = head.toString('latin1').replace(/^ï»¿/, '').trimStart().toLowerCase();
  return htmlStarts.some((prefix) => start.startsWith(prefix));
}

/**
 * Whether a stored file's first bytes fit the media type its upload declared (ADR-0029): a PDF by
 * its signature, HTML by its opening tag, plain text by holding no binary byte.
 */
export function fitsFileType(mediaType: CorrectionFileType, head: Buffer): boolean {
  switch (mediaType) {
    case 'application/pdf':
      return head.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'text/html':
      return isText(head) && looksLikeHtml(head);
    case 'text/plain':
      return isText(head) && !head.subarray(0, 5).equals(Buffer.from('%PDF-', 'latin1'));
  }
}
