# ADR-0028: The independent check reads a PDF's text layer with pdf.js

- Status: Accepted
- Date: 2026-11-11
- Issue: [#363](https://github.com/fernandolisboa/arca/issues/363) (spec [#351](https://github.com/fernandolisboa/arca/issues/351))
- Amends: [ADR-0027](0027-admins-and-the-checked-batch-activation.md) (what the check reads); [ADR-0010](0010-stack-revised.md) (one dependency outside the stack)

## Context

Many official texts exist only as PDFs: Portugal's Diário da República, Poland's Journal of Laws through the Sejm's ELI API, Iceland's gazette, Irish statutory instruments before their HTML form, policy documents. The independent check refused every `application/pdf` answer, so the items resting on them could not be checked. On 2026-11-11 the knowledge data named 33 distinct PDF addresses (18 of them in route versions), and the Portuguese routes had 1 of 46 items matching after their audit, every other one could not be checked.

## Decision

- The check reads an `application/pdf` answer as the text of its pages, in order, through **pdf.js** (`pdfjs-dist`, Mozilla), its Node build, in `apps/api/src/knowledge/check/pdf-text.ts`. Each text item is appended as it comes and a line ends where pdf.js says one does; pages are a blank line apart. From there the text is a page's text: the same caps, the same passages for a long one, the same quote and value checks. No prompt changes.
- **Bytes in, text out.** pdf.js gets the bytes the fetcher already received under its byte and decompression caps, never a URL. It fetches no fonts, character maps or WebAssembly, uses no system fonts or canvas, and reads no forms (XFA), annotations, links, attachments or scripts: only `getTextContent` is called. pdf.js 6 has no code path that compiles code from a file (the `isEvalSupported` switch behind CVE-2024-4367 is gone). Its worker runs on the same thread, handed over as a module, so nothing is loaded by path.
- **Caps.** At most 400 pages; a longer file is `too_large`, as a body past the byte cap is. The fetch's own time limit is checked between pages.
- **Reasons.** A file pdf.js cannot open is `pdf_unreadable`; one whose pages carry no text, such as a scan, is `pdf_no_text`. Both are fetch failures like any other: the step completes and the items citing the file could not be checked, with the reason shown.
- **The dependency.** `pdfjs-dist` 6.5.438: maintained by Mozilla, published with npm provenance from the project's own repository, no dependencies, no install scripts, Apache-2.0. Its one optional dependency, `@napi-rs/canvas`, is native code for rendering; `ignoredOptionalDependencies` keeps it out of the install. It is loaded on the first PDF only, so no other request pays for it.
- A sourced value the check now reads from a PDF needs no new version: the cited addresses do not change. A rule audit may now name a PDF as a source's `machineReadableUrl`.

## Alternatives

| Option | Why not |
| --- | --- |
| Send the PDF to the model as a document | ADR-0027 refuses it: the quotes are checked in code against the text the server read, and a model that reads the file itself gives text the code cannot see |
| `unpdf` | A repackaged pdf.js from a third party; its provenance attests that build, not Mozilla's, and its fixes arrive after pdf.js's |
| `pdf-parse` | Wraps pdf.js too, with its own release cadence and fewer maintainers |
| `pdftotext` (Poppler) | Native code and a binary to ship to the function |
| A parser of our own | No home-made parsing of a format this large; the text layer depends on font encodings and content streams |
| Reading PDFs in a worker thread or another process | Would bound one page's CPU time as well as the whole read's; the byte cap already bounds the input, and the step runs alone in its own function invocation. Revisit if a hostile file is seen to stall it |

## Consequences

- The Portuguese, Polish and Icelandic gazette texts, and other PDFs on official hosts, can confirm items.
- A text layer reads in the order the file draws it: multi-column pages and tables can come out interleaved, so some items still come back read and not confirmed. A file whose text uses fonts without a Unicode map (some East Asian PDFs, which need character maps the check does not load) gives text that does not match, and its items could not be checked.
- pdf.js prints a warning on load that it found no canvas; it is harmless, since nothing is rendered.
- **Residual risks, accepted:** a hostile PDF under the byte cap could keep one page's text extraction busy; the time limit is checked only between pages, so one page can run past it until the function's own limit stops the step. pdf.js is a large parser of hostile input, so its updates follow Dependabot like any dependency, and a security release is taken without waiting for a grouped update.
