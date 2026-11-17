import { routeVersionSchema, scriptedCheckerModel } from '@arca/domain';
import type { RuleResearcher, RuleValidator } from './ports.js';

const promptVersion = 'scripted';

/** The next calendar day, so the re-proposed version starts after the one it updates. */
const dayAfter = (date: string): string => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};

/**
 * Research outside production (ADR-0031), which calls no model: it proposes the current version
 * again as the next number, starting a day later, with its own cases and no quotes, so every item lands in a list and
 * the whole pipeline runs, correction included, at no cost.
 */
export const scriptedRuleResearcher: RuleResearcher = {
  research: ({ current, currentCases }) => {
    const parsed = routeVersionSchema.safeParse(current);
    // The re-proposed version corrects nothing and starts after the one it updates.
    const version = parsed.success
      ? {
          ...Object.fromEntries(Object.entries(parsed.data).filter(([key]) => key !== 'corrects')),
          number: parsed.data.number + 1,
          effectiveFrom: dayAfter(parsed.data.effectiveFrom),
        }
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
  promptVersion,
  validate: (items) =>
    Promise.resolve({
      reply: items.map(({ id }) => ({ id, choice: 'cannot_tell' as const, confidence: 1 })),
      model: scriptedCheckerModel,
      promptVersion,
    }),
};
