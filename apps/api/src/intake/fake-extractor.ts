import type { Extractor } from './extractor.js';
import { intakePromptVersion } from './prompt.js';

/**
 * A scripted model for a development server that asks for it, such as the e2e build: the writer,
 * the people already in the case the text names, and one child of the writer, born in the first
 * year the text states and Italian when the text says "itali". Nothing leaves the process.
 */
export const fakeExtractor: Extractor = {
  draft(maskedText, knownPlaceholders) {
    const year = /(?<![0-9])(?:19|20)[0-9]{2}(?![0-9])/u.exec(maskedText)?.[0];
    return Promise.resolve({
      reply: {
        people: [
          ...knownPlaceholders.map((ref) => ({ ref })),
          { ref: 'n1', role: 'self' },
          {
            ref: 'n2',
            role: 'child',
            ...(year === undefined ? {} : { birthDate: year }),
            ...(/itali/iu.test(maskedText) ? { citizenships: ['IT'] } : {}),
          },
        ],
        relationships: [{ kind: 'parent', parent: 'n1', child: 'n2' }],
      },
      model: 'fake',
      promptVersion: intakePromptVersion,
    });
  },
};
