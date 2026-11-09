import { normalizeWhitespace, scriptedCheckerModel } from '@arca/domain';
import type { RuleChecker, RuleCheckerChoice } from './checker.js';

export const scriptedCheckerPromptVersion = 'scripted-1';

/**
 * The scripted checker for every environment but production, and for tests and the e2e build: for
 * each item whose first cited page was read it says the page matches, quoting the
 * page's opening words; otherwise it could not check. Nothing leaves the process, and
 * a report it writes is never clean, whatever it says.
 */
export const scriptedChecker: RuleChecker = {
  check({ items, pages }) {
    const texts = new Map(pages.map((page) => [page.url, normalizeWhitespace(page.text)]));
    return Promise.resolve({
      reply: {
        items: items.map(({ key, urls }) => {
          const [url] = urls;
          const text = url === undefined ? undefined : texts.get(url);
          return text === undefined || text.length < 12
            ? { key, status: 'could_not_check' }
            : { key, status: 'matches', quotes: [{ url, quote: text.slice(0, 120).trimEnd() }] };
        }),
      },
      model: scriptedCheckerModel,
      promptVersion: scriptedCheckerPromptVersion,
    });
  },
};

export const scriptedCheckerChoice: RuleCheckerChoice = {
  checker: scriptedChecker,
  model: scriptedCheckerModel,
  promptVersion: scriptedCheckerPromptVersion,
};
