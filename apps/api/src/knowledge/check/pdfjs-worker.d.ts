// pdf.js ships no types for its worker module; the check only hands the module back to pdf.js.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
