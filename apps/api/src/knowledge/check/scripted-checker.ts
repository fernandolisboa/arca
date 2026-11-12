import { normalizeWhitespace, scriptedCheckerModel } from '@arca/domain';
import { setTimeout as sleep } from 'node:timers/promises';
import type { RuleChecker, RuleCheckerChoice } from './checker.js';

export const scriptedCheckerPromptVersion = 'scripted-1';

/** How far apart the scripted checker hands on its entries, so a screen shows them landing. */
const scriptedEntrySpacingMs = 300;

/**
 * The scripted checker for every environment but production, and for tests and the e2e build: for
 * each item whose first cited page was read it says the page matches, quoting the
 * page's opening words; otherwise it could not check. It hands on each entry `spacingMs` apart, as
 * a streamed answer would. Nothing leaves the process, and a report it writes is never clean,
 * whatever it says.
 */
export function scriptedCheckerSpaced(spacingMs: number): RuleChecker {
  return {
    async check({ items, pages }, onEntry) {
      const texts = new Map(pages.map((page) => [page.url, normalizeWhitespace(page.text)]));
      const entries = items.map(({ key, urls }) => {
        const [url] = urls;
        const text = url === undefined ? undefined : texts.get(url);
        return text === undefined || text.length < 12
          ? { key, status: 'could_not_check' }
          : { key, status: 'matches', quotes: [{ url, quote: text.slice(0, 120).trimEnd() }] };
      });
      for (const entry of entries) {
        if (spacingMs > 0) await sleep(spacingMs);
        onEntry?.(entry);
      }
      return {
        reply: { items: entries },
        model: scriptedCheckerModel,
        promptVersion: scriptedCheckerPromptVersion,
      };
    },
  };
}

export const scriptedChecker = scriptedCheckerSpaced(scriptedEntrySpacingMs);

export const scriptedCheckerChoice: RuleCheckerChoice = {
  checker: scriptedChecker,
  model: scriptedCheckerModel,
  promptVersion: scriptedCheckerPromptVersion,
};
