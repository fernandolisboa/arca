import { type CheckItemKind, maxCheckItemKeyLength, scriptedCheckerModel } from '@arca/domain';
import { z } from 'zod';
import type { ModelReply } from '../../ai/model-call.js';

/** What a locator reads of one long page: public rule data and the page's outline (ADR-0027). */
export interface PassageLocateRequest {
  /** The items that cite the page. */
  readonly items: readonly {
    readonly key: string;
    readonly kind: CheckItemKind;
    readonly title: string;
  }[];
  /** The titles of the version's sources at the page's URL, which name the articles relied on. */
  readonly sourceTitles: readonly string[];
  /** One numbered line per passage, already framed as data. */
  readonly outline: string;
}

/**
 * The `PassageLocator` port (ADR-0027): picks, for each item, the passages of a long page where
 * its provision should be, so the check reads those instead of the page's opening. Its reply is
 * untrusted data parsed against the closed schema below; all it can do is choose which verbatim
 * passages of the page are sent. An adapter throws a `PassageLocatorError` with a fixed code.
 */
export interface PassageLocator {
  locate(request: PassageLocateRequest): Promise<ModelReply>;
}

export type PassageLocatorFailure =
  'locate_timeout' | 'locate_unavailable' | 'locate_unparsable' | 'locate_failed';

export class PassageLocatorError extends Error {
  override name = 'PassageLocatorError';
  readonly code: PassageLocatorFailure;
  constructor(code: PassageLocatorFailure) {
    super(code);
    this.code = code;
  }
}

// These only bound the parse: code keeps the passages of the page, a few per item.
const maxParsedItems = 200;
const maxParsedPassages = 50;
const maxPassageNumber = 1_000_000;

/** The closed schema of a locator's answer: passage numbers per item key, best first. */
export const PassageLocation = z.strictObject({
  items: z
    .array(
      z.strictObject({
        key: z.string().max(maxCheckItemKeyLength),
        passages: z.array(z.int().min(0).max(maxPassageNumber)).max(maxParsedPassages),
      }),
    )
    .max(maxParsedItems),
});

/** Each item's picks by key, or undefined when the reply does not parse. */
export function parsePassageLocation(
  reply: unknown,
): ReadonlyMap<string, readonly number[]> | undefined {
  const parsed = PassageLocation.safeParse(reply);
  if (!parsed.success) return undefined;
  return new Map(parsed.data.items.map(({ key, passages }) => [key, passages]));
}

const scriptedLocatorPromptVersion = 'scripted-1';

/**
 * The scripted locator for every environment but production, and for tests: it picks nothing, so
 * a long page is sent as its opening, cut, nothing leaves the process and no token is spent.
 */
export const scriptedLocator: PassageLocator = {
  locate: ({ items }) =>
    Promise.resolve({
      reply: { items: items.map(({ key }) => ({ key, passages: [] })) },
      model: scriptedCheckerModel,
      promptVersion: scriptedLocatorPromptVersion,
      inputTokens: 0,
      outputTokens: 0,
    }),
};
