import type { CheckStatus } from './answers.js';
import type { CheckItem } from './items.js';
import { type CheckCost, type ModelUsage, type PriceTable, checkCost } from './cost.js';
import { type CheckStart, fetchOutcomes, startLifetime } from './reports.js';

/** What a page event says of a cited page: about to be read, read, or why it was not. */
export const pageProgressOutcomes = ['reading', ...fetchOutcomes] as const;
export type PageProgressOutcome = (typeof pageProgressOutcomes)[number];

/** Why a check ended with no report. Fixed codes only: they reach the table and the screen. */
export const progressFailures = ['check_unknown_version', 'check_failed'] as const;
export type ProgressFailure = (typeof progressFailures)[number];

/**
 * One step of a running check as it records it (ADR-0027, "On demand, with progress"): counts,
 * a cited URL, an item's key with its status as code verified it, and fixed codes only, never page
 * text or anything a model wrote.
 */
export type CheckProgressEvent =
  | { readonly kind: 'started'; readonly items: number; readonly pages: number }
  | {
      readonly kind: 'page';
      readonly url: string;
      readonly outcome: PageProgressOutcome;
      /** The final HTTP status once read or refused, when there was one. */
      readonly status: number | null;
    }
  | { readonly kind: 'locating'; readonly pages: number }
  | {
      readonly kind: 'comparing';
      /** The items this comparison answers; every item when absent. */
      readonly keys?: readonly string[] | undefined;
    }
  | { readonly kind: 'item'; readonly key: string; readonly status: CheckStatus }
  | ({ readonly kind: 'usage' } & ModelUsage)
  | { readonly kind: 'finished' }
  | { readonly kind: 'failed'; readonly code: ProgressFailure };

export const checkProgressStates = ['running', 'finished', 'failed', 'dead'] as const;
export type CheckProgressState = (typeof checkProgressStates)[number];

/** How far a check got: the last stage it entered. */
export const checkProgressStages = ['starting', 'reading', 'locating', 'comparing'] as const;
export type CheckProgressStage = (typeof checkProgressStages)[number];

export interface PageProgress {
  readonly url: string;
  readonly outcome: PageProgressOutcome;
  readonly status: number | null;
}

/** An item of the check, with its status once the checker answered it and code verified it. */
export interface ItemProgress {
  readonly key: string;
  readonly kind: CheckItem['kind'];
  readonly title: string;
  readonly status: CheckStatus | null;
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
  /** Every item of the version in its order; a key no item has is left out. */
  readonly items: readonly ItemProgress[];
  readonly failure: ProgressFailure | null;
  /** What its model calls cost so far, or null before the first one. */
  readonly cost: CheckCost | null;
}

const stageOf: Partial<Record<CheckProgressEvent['kind'], CheckProgressStage>> = {
  started: 'reading',
  locating: 'locating',
  comparing: 'comparing',
};

/** What each model call of a check used, from its events. */
export function usagesOf(events: readonly CheckProgressEvent[]): ModelUsage[] {
  return events.flatMap((event) =>
    event.kind === 'usage'
      ? [
          {
            model: event.model,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            cacheReadTokens: event.cacheReadTokens,
            cacheWriteTokens: event.cacheWriteTokens,
          },
        ]
      : [],
  );
}

/**
 * Reduces a start and its events, in the order recorded, into the progress view. The stored
 * report is the authority on a check having finished, since a progress write may fail without
 * failing the check; a start with neither a report nor a failure is dead after its 30 minutes.
 * An item takes its latest status since the last comparison of it began, so a retry starts afresh.
 */
export function checkProgress(
  start: CheckStart,
  events: readonly CheckProgressEvent[],
  reported: boolean,
  now: number,
  prices: PriceTable,
  items: readonly Pick<CheckItem, 'key' | 'kind' | 'title'>[],
): CheckProgress {
  const statuses = new Map<string, CheckStatus>();
  const pages = new Map<string, PageProgress>();
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
        pages.set(event.url, { url: event.url, outcome: event.outcome, status: event.status });
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
      case 'item':
        statuses.set(event.key, event.status);
        break;
      case 'comparing':
        if (event.keys === undefined) statuses.clear();
        else for (const key of event.keys) statuses.delete(key);
        break;
      case 'usage':
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
    pages: [...pages.values()],
    locatedPages,
    items: items.map(({ key, kind, title }) => ({
      key,
      kind,
      title,
      status: statuses.get(key) ?? null,
    })),
    failure: state === 'failed' ? failure : null,
    cost: checkCost(usagesOf(events), prices),
  };
}
