import { criterionSuggestionPromptVersion } from './prompt.js';
import type { CriterionSuggester } from './suggester.js';

/**
 * A scripted model for a development server that asks for it, such as the e2e build: two fixed
 * suggestions, the first one repeating the first known name so the screen's filter shows. Nothing
 * leaves the process.
 */
export const fakeSuggester: CriterionSuggester = {
  suggest(known) {
    return Promise.resolve({
      reply: {
        suggestions: [
          ...(known[0] === undefined ? [] : [{ name: known[0], weight: 3 }]),
          { name: 'Licença-maternidade e paternidade', weight: 3 },
          { name: 'Custo de creche', weight: 2 },
        ],
      },
      model: 'fake',
      promptVersion: criterionSuggestionPromptVersion,
    });
  },
};
