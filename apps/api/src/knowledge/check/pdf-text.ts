import { Worker } from 'node:worker_threads';
import type { FetchFailure } from '@arca/domain';

/** What reading a PDF's text gave: its text, or the fixed reason it gave none. */
export type PdfRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly failure: Extract<FetchFailure, PdfFailure> };

type PdfFailure = 'pdf_unreadable' | 'too_large' | 'timeout';

/** The most pages read from one file; a longer one is too large, as a page past the byte cap is. */
export const maxPdfPages = 400;

/**
 * The heap a read may use. A file's compressed streams can hold far more than its bytes, so a read
 * past this is stopped and the file is too large.
 */
const threadLimits = { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 };

/**
 * How far the process's memory may grow while a file is read, and how often that is looked at. A
 * stream pdf.js inflates lives outside the heap the limits above bound, so the process's resident
 * memory is watched instead; growth from other work in the process counts too, which fails safe.
 */
const maxReadGrowthBytes = 512 * 1024 * 1024;
const memoryWatchMs = 25;

interface ExtractInput {
  readonly library: string;
  readonly worker: string;
  readonly bytes: Uint8Array;
  readonly maxPages: number;
  readonly maxTextLength: number;
}

type ExtractReply =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly failure: 'pdf_unreadable' | 'too_large' };

/**
 * Runs inside the reading thread, so it imports nothing at module level and its source is sent as
 * is: pdf.js, given the bytes alone, reads each page's text items, an item that ends a line breaks
 * it, pages a blank line apart. No URL, fonts, maps or WebAssembly are fetched, and no forms,
 * scripts, attachments or links are read. Text inside optional content a page's content marks is
 * left out when the file switches any layer off: pdf.js does not say which layer a mark belongs
 * to, so every layer's text goes, which fails safe. Reading stops once the text passes
 * `maxTextLength`.
 */
export async function extractPdfText({
  library,
  worker,
  bytes,
  maxPages,
  maxTextLength,
}: ExtractInput): Promise<ExtractReply> {
  interface Item {
    readonly str?: string;
    readonly hasEOL?: boolean;
    readonly type?: string;
    readonly tag?: string | null;
  }
  type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
  // The thread has no package resolution of the bundle's, so it imports pdf.js by the addresses
  // its caller resolved from the literal specifiers in `pdfText`.
  // eslint-disable-next-line no-restricted-syntax
  const [pdfjs, handler] = (await Promise.all([import(library), import(worker)])) as [
    PdfJs,
    unknown,
  ];
  // The worker module, handed over as the global pdf.js looks for, runs on this thread.
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = handler;
  const task = pdfjs.getDocument({
    data: bytes,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    useWasm: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    stopAtErrors: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  try {
    const document = await task.promise;
    if (document.numPages > maxPages) return { ok: false, failure: 'too_large' };
    const layers = await document.getOptionalContentConfig();
    const groups = layers as unknown as Iterable<[string, { readonly visible: boolean }]>;
    const dropOptional = [...groups].some(([, group]) => !group.visible);
    let text = '';
    for (let number = 1; number <= document.numPages && text.length <= maxTextLength; number += 1) {
      const page = await document.getPage(number);
      const { items } = await page.getTextContent({ includeMarkedContent: true });
      if (number > 1) text += '\n\n';
      const marks: boolean[] = [];
      for (const { str, hasEOL, type, tag } of items as readonly Item[]) {
        if (type === 'beginMarkedContent' || type === 'beginMarkedContentProps') {
          marks.push(tag === 'OC');
        } else if (type === 'endMarkedContent') {
          marks.pop();
        } else if (!dropOptional || !marks.includes(true)) {
          if (str !== undefined) text += str;
          if (hasEOL === true) text += '\n';
          if (text.length > maxTextLength) break;
        }
      }
      page.cleanup();
    }
    return { ok: true, text };
  } catch {
    return { ok: false, failure: 'pdf_unreadable' };
  } finally {
    await task.destroy();
  }
}

/** A character of a script written top to bottom: Han, kana, Hangul and their full-width marks. */
const verticalScript =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]$/u;

/**
 * Vertical text, as Japanese laws are printed, rejoined into lines: pdf.js ends a line after each
 * glyph of a vertical column, so a run of lines that each hold one such character is one line.
 * Horizontal text and other scripts pass unchanged.
 */
export function joinVerticalLines(text: string): string {
  const out: string[] = [];
  let column = '';
  const flush = () => {
    if (column !== '') out.push(column);
    column = '';
  };
  for (const line of text.split('\n')) {
    if (verticalScript.test(line)) {
      column += line;
      continue;
    }
    flush();
    out.push(line);
  }
  flush();
  return out.join('\n');
}

/**
 * The reading thread's module: `extractPdfText` as compiled, run on the input the thread is given.
 * A bundler that keeps function names wraps them in `__name`, and the test runner rewrites dynamic
 * imports to a helper of its own, so the module defines both as the plain forms they stand for.
 */
const threadModule = `import { parentPort, workerData } from 'node:worker_threads';
const __name = (target) => target;
const __vite_ssr_dynamic_import__ = (specifier) => import(specifier);
const extract = ${extractPdfText.toString()};
parentPort.postMessage(await extract(workerData));
`;

const isReply = (message: unknown): message is ExtractReply => {
  if (typeof message !== 'object' || message === null) return false;
  const reply = message as { ok?: unknown; text?: unknown; failure?: unknown };
  return reply.ok === true
    ? typeof reply.text === 'string'
    : reply.failure === 'pdf_unreadable' || reply.failure === 'too_large';
};

/**
 * The text layer of a PDF (ADR-0028), read in a thread of its own with a heap limit, which is
 * stopped when the signal aborts or the process's memory grows past a bound: pdf.js runs its parsing as one unbroken chain of work, so only a
 * thread the caller can stop bounds the time a hostile file takes. A file of more than
 * `maxPdfPages` pages, or one whose reading runs out of memory, is too large; one pdf.js cannot open
 * is unreadable; and the caller cuts the text to its cap. The caller's bytes are copied, not moved.
 */
export function pdfText(
  bytes: Uint8Array,
  signal: AbortSignal,
  maxTextLength: number,
): Promise<PdfRead> {
  if (signal.aborted) return Promise.resolve({ ok: false, failure: 'timeout' });
  return new Promise((resolve) => {
    // A copy, even of a Buffer, whose own `slice` is a view of the same memory.
    const copy = new Uint8Array(bytes);
    let thread: Worker;
    try {
      const input: ExtractInput = {
        library: import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'),
        worker: import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
        bytes: copy,
        maxPages: maxPdfPages,
        maxTextLength,
      };
      thread = new Worker(new URL(`data:text/javascript,${encodeURIComponent(threadModule)}`), {
        workerData: input,
        transferList: [copy.buffer],
        resourceLimits: threadLimits,
        // pdf.js needs no environment, so a flaw in it reaches none of the process's secrets.
        env: {},
        // pdf.js writes its warnings to the console; they stay in the thread.
        stdout: true,
        stderr: true,
      });
    } catch {
      resolve({ ok: false, failure: 'pdf_unreadable' });
      return;
    }
    thread.stdout.resume();
    thread.stderr.resume();
    let settled = false;
    const baseline = process.memoryUsage.rss();
    const watch = setInterval(() => {
      if (process.memoryUsage.rss() - baseline > maxReadGrowthBytes) {
        settle({ ok: false, failure: 'too_large' });
      }
    }, memoryWatchMs);
    const settle = (read: PdfRead) => {
      if (settled) return;
      settled = true;
      clearInterval(watch);
      signal.removeEventListener('abort', onAbort);
      void thread.terminate();
      resolve(read);
    };
    const onAbort = () => {
      settle({ ok: false, failure: 'timeout' });
    };
    signal.addEventListener('abort', onAbort, { once: true });
    thread.on('message', (message: unknown) => {
      if (!isReply(message)) settle({ ok: false, failure: 'pdf_unreadable' });
      // Text past the cap stays as read, so the caller still sees it was cut.
      else if (!message.ok || message.text.length > maxTextLength) settle(message);
      else settle({ ok: true, text: joinVerticalLines(message.text) });
    });
    thread.on('error', (error: { code?: unknown }) => {
      const outOfMemory = error.code === 'ERR_WORKER_OUT_OF_MEMORY';
      settle({ ok: false, failure: outOfMemory ? 'too_large' : 'pdf_unreadable' });
    });
    thread.on('exit', () => {
      settle({ ok: false, failure: 'pdf_unreadable' });
    });
  });
}
