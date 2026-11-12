import { type CorrectionSource, correctionLimits } from '@arca/api-contract/client';

/** The wizard's steps for a request for a new route (ADR-0029, new routes), in order. */
export const routeRequestSteps = ['route', 'pages', 'passages', 'review'] as const;
export type RouteRequestStep = (typeof routeRequestSteps)[number];

/** What the admin is asked to paste, one group each, so no kind of rule is forgotten. */
export const passageTopics = ['requirements', 'amounts', 'deadlines', 'dependents'] as const;
export type PassageTopic = (typeof passageTopics)[number];

/** A file chosen for a page: uploading, uploaded with its upload's ID, or failed. */
export interface PageFile {
  readonly name: string;
  readonly state: 'sending' | 'ready' | 'failed';
  readonly uploadId?: string;
}

/** An official page: its address, and the copy saved from it, if any. */
export interface PageDraft {
  readonly id: number;
  readonly url: string;
  readonly file?: PageFile;
}

/** A passage pasted from a page, under the topic it was asked for. */
export interface PassageDraft {
  readonly id: number;
  readonly topic: PassageTopic;
  readonly text: string;
  /** The address of the page it came from, or empty when the admin named none. */
  readonly pageUrl: string;
}

export interface RouteRequestDraft {
  readonly countryCode: string;
  readonly note: string;
  readonly pages: readonly PageDraft[];
  readonly passages: readonly PassageDraft[];
}

const httpsAddress = /^https:\/\/[^\s/?#]+\.[^\s]+$/;

/** Whether a typed address can be filed: a full `https` address within the length limit. */
export const isPageAddress = (url: string) =>
  url.length <= correctionLimits.url && httpsAddress.test(url.trim());

/** The pages the admin started, blank ones left out. */
const startedPages = (pages: readonly PageDraft[]) =>
  pages.filter((page) => page.url.trim() !== '' || page.file !== undefined);

const filledPassages = (passages: readonly PassageDraft[]) =>
  passages.filter((passage) => passage.text.trim() !== '');

/** How many sources the draft files as it stands; the API takes at most `routeSources`. */
export const sourceCount = ({ pages, passages }: RouteRequestDraft) =>
  startedPages(pages).length + filledPassages(passages).length;

/** Whether the draft may hold one more page or passage. */
export const canAddSource = (draft: RouteRequestDraft) =>
  draft.pages.length + draft.passages.length < correctionLimits.routeSources;

/** The distinct addresses of the pages so far, for a passage to name the page it came from. */
export const pageAddresses = (pages: readonly PageDraft[]) => [
  ...new Set(pages.map(({ url }) => url.trim()).filter(isPageAddress)),
];

/**
 * Whether the admin may go on from a step: a country and a note first; then at least one page,
 * each with a full address and no file still sending or failed; passages and review always.
 */
export function stepReady(step: RouteRequestStep, draft: RouteRequestDraft): boolean {
  switch (step) {
    case 'route':
      return draft.countryCode !== '' && draft.note.trim() !== '';
    case 'pages': {
      const pages = startedPages(draft.pages);
      return (
        pages.length > 0 &&
        pages.every((page) => isPageAddress(page.url) && page.file?.state !== 'sending') &&
        pages.every((page) => page.file?.state !== 'failed')
      );
    }
    case 'passages':
    case 'review':
      return sourceCount(draft) <= correctionLimits.routeSources;
  }
}

/**
 * The sources as the API takes them: each page as its saved copy, which names the page it copies,
 * or as a link when no copy was attached; then each passage, with its page when it names one.
 */
export function routeRequestSources({ pages, passages }: RouteRequestDraft): CorrectionSource[] {
  const filedPages = startedPages(pages).map((page): CorrectionSource => {
    const url = page.url.trim();
    return page.file?.uploadId === undefined
      ? { kind: 'link', url }
      : { kind: 'file', uploadId: page.file.uploadId, pageUrl: url };
  });
  const filedPassages = filledPassages(passages).map(({ text, pageUrl }): CorrectionSource => ({
    kind: 'text',
    text: text.trim(),
    ...(pageUrl === '' ? {} : { url: pageUrl }),
  }));
  return [...filedPages, ...filedPassages];
}
