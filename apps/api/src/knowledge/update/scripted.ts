import { scriptedCheckerModel } from '@arca/domain';
import type { RuleResearcher, RuleValidator } from './ports.js';

const promptVersion = 'scripted';

/**
 * Research outside production (ADR-0031), which calls no model: it proposes the current version
 * again as the next number, with its own cases and no quotes, so every item lands in a list and
 * the whole pipeline runs, correction included, at no cost.
 */
export const scriptedRuleResearcher: RuleResearcher = {
  research: ({ current, currentCases }) => {
    const version =
      typeof current === 'object' && current !== null && 'number' in current
        ? { ...current, number: Number(current.number) + 1 }
        : current;
    return Promise.resolve({
      reply: {
        versionJson: JSON.stringify(version),
        casesJson: JSON.stringify(currentCases),
        quotes: [],
      },
      model: scriptedCheckerModel,
      promptVersion,
    });
  },
};

/** The validator outside production: it calls no model and can tell nothing. */
export const scriptedRuleValidator: RuleValidator = {
  validate: (items) =>
    Promise.resolve({
      reply: items.map(({ id }) => ({ id, choice: 'cannot_tell' as const, confidence: 1 })),
      model: scriptedCheckerModel,
      promptVersion,
    }),
};
