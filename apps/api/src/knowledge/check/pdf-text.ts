import type { FetchFailure } from '@arca/domain';

/** What reading a PDF's text gave: its text, or the fixed reason it gave none. */
export type PdfRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly failure: Extract<FetchFailure, PdfFailure> };

type PdfFailure = 'pdf_no_text' | 'pdf_unreadable' | 'too_large' | 'timeout';

/** The most pages read from one file; a longer one is too large, as a page past the byte cap is. */
export const maxPdfPages = 400;

interface TextItem {
  readonly str?: string;
  readonly hasEOL?: boolean;
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let loaded: Promise<PdfJs> | undefined;

/**
 * pdf.js, loaded on the first PDF only, with its worker run on this thread: the worker module is
 * handed to it as the global it looks for, so it never imports a script by path.
 */
function pdfjs(): Promise<PdfJs> {
  loaded ??= (async () => {
    const [library, worker] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ]);
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return library;
  })();
  return loaded;
}

/** One page's text items as lines: an item that ends a line breaks it. */
function pageText(items: readonly TextItem[]): string {
  let text = '';
  for (const { str, hasEOL } of items) {
    if (str !== undefined) text += str;
    if (hasEOL === true) text += '\n';
  }
  return text;
}

/**
 * The text layer of a PDF (ADR-0028), read from its bytes alone: no URL, no fonts or maps fetched,
 * no forms, scripts, attachments or links read.
 * Pages are read in order up to `maxPdfPages`, and the signal is checked between them. A file
 * pdf.js cannot open, or whose pages have no text at all, such as a scan, gives a fixed reason.
 */
export async function pdfText(bytes: Uint8Array, signal: AbortSignal): Promise<PdfRead> {
  const library = await pdfjs();
  const task = library.getDocument({
    data: bytes,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    useWasm: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    stopAtErrors: true,
    verbosity: library.VerbosityLevel.ERRORS,
  });
  try {
    const document = await task.promise;
    if (document.numPages > maxPdfPages) return { ok: false, failure: 'too_large' };
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      if (signal.aborted) return { ok: false, failure: 'timeout' };
      const page = await document.getPage(number);
      const { items } = await page.getTextContent();
      pages.push(pageText(items as readonly TextItem[]));
      page.cleanup();
    }
    const text = pages.join('\n\n');
    return text.trim() === '' ? { ok: false, failure: 'pdf_no_text' } : { ok: true, text };
  } catch {
    return { ok: false, failure: signal.aborted ? 'timeout' : 'pdf_unreadable' };
  } finally {
    await task.destroy();
  }
}
