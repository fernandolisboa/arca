import { type CheckStart, type FetchFailure, fetchOutcomes, startLifetime } from './reports.js';

/** What a page event says of a cited page: about to be read, read, or why it was not. */
export const pageProgressOutcomes = ['reading', ...fetchOutcomes] as const;
export type PageProgressOutcome = (typeof pageProgressOutcomes)[number];

/** Why a check ended with no report. Fixed codes only: they reach the table and the screen. */
export const progressFailures = ['check_unknown_version', 'check_failed'] as const;
export type ProgressFailure = (typeof progressFailures)[number];

/**
 * One step of a running check as it records it (ADR-0027, "On demand, with progress"): counts,
 * a cited URL and fixed codes only, never page text or anything a model wrote.
 */
export type CheckProgressEvent =
  | { readonly kind: 'started'; readonly items: number; readonly pages: number }
  | { readonly kind: 'page'; readonly url: string; readonly outcome: PageProgressOutcome }
  | { readonly kind: 'locating'; readonly pages: number }
  | { readonly kind: 'comparing' }
  | { readonly kind: 'finished' }
  | { readonly kind: 'failed'; readonly code: ProgressFailure };

export const checkProgressEventKinds = [
  'started',
  'page',
  'locating',
  'comparing',
  'finished',
  'failed',
] as const satisfies readonly CheckProgressEvent['kind'][];

export const checkProgressStates = ['running', 'finished', 'failed', 'dead'] as const;
export type CheckProgressState = (typeof checkProgressStates)[number];

/** How far a check got: the last stage it entered. */
export const checkProgressStages = ['starting', 'reading', 'locating', 'comparing'] as const;
export type CheckProgressStage = (typeof checkProgressStages)[number];

export interface PageProgress {
  readonly url: string;
  readonly outcome: 'reading' | 'read' | FetchFailure;
}

/** A start and what its check recorded, as the progress screen shows it. */
export interface CheckProgress {
  readonly startedAt: number;
  readonly state: CheckProgressState;
  readonly stage: CheckProgressStage;
  /** How many items and cited pages the check covers, once it said so. */
  readonly itemCount: number | null;
  readonly pageCount: number | null;
  /** Each cited page in the order first read, with its latest outcome. */
  readonly pages: readonly PageProgress[];
  /** How many long pages had passages picked, once that stage began. */
  readonly locatedPages: number | null;
  readonly failure: ProgressFailure | null;
}

const stageOf: Partial<Record<CheckProgressEvent['kind'], CheckProgressStage>> = {
  started: 'reading',
  locating: 'locating',
  comparing: 'comparing',
};

/**
 * Reduces a start and its events, in the order recorded, into the progress view. The stored
 * report is the authority on a check having finished, since a progress write may fail without
 * failing the check; a start with neither a report nor a failure is dead after its 30 minutes.
 */
export function checkProgress(
  start: CheckStart,
  events: readonly CheckProgressEvent[],
  reported: boolean,
  now: number,
): CheckProgress {
  const pages = new Map<string, PageProgressOutcome>();
  let stage: CheckProgressStage = 'starting';
  let itemCount: number | null = null;
  let pageCount: number | null = null;
  let locatedPages: number | null = null;
  let finished = reported;
  let failure: ProgressFailure | null = null;
  for (const event of events) {
    stage = stageOf[event.kind] ?? stage;
    switch (event.kind) {
      case 'started':
        itemCount = event.items;
        pageCount = event.pages;
        break;
      case 'page':
        pages.set(event.url, event.outcome);
        break;
      case 'locating':
        locatedPages = event.pages;
        break;
      case 'finished':
        finished = true;
        break;
      case 'failed':
        failure = event.code;
        break;
      case 'comparing':
        break;
    }
  }
  const state: CheckProgressState = finished
    ? 'finished'
    : failure !== null
      ? 'failed'
      : now - start.startedAt < startLifetime
        ? 'running'
        : 'dead';
  return {
    startedAt: start.startedAt,
    state,
    stage,
    itemCount,
    pageCount,
    pages: [...pages].map(([url, outcome]) => ({ url, outcome })),
    locatedPages,
    failure: state === 'failed' ? failure : null,
  };
}
