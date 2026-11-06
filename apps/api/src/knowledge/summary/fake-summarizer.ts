import { ruleSummaryPromptVersion } from './prompt.js';
import type { Summarizer } from './summarizer.js';

/**
 * A scripted model for a development server that asks for it, such as the e2e build: it names the
 * version's title and points at its first source. Nothing leaves the process.
 */
export const fakeSummarizer: Summarizer = {
  summarize(content) {
    const version = JSON.parse(content) as {
      readonly title?: string;
      readonly sources?: readonly { readonly title?: string }[];
    };
    return Promise.resolve({
      reply: {
        overview: `Resumo de teste de ${version.title ?? '?'}.`,
        watchPoints: [`Confira a fonte ${version.sources?.[0]?.title ?? '?'}.`],
      },
      model: 'fake',
      promptVersion: ruleSummaryPromptVersion,
    });
  },
};
