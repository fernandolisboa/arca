/**
 * The intake evaluation (spec 0008, R5): every case through the same path the draft route takes,
 * against the Claude adapter, scored and judged against the baseline. It refuses to run without
 * a key, since a score without the model would say nothing about it.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import type { IntakeDraft } from '@arca/domain';
import { expect, it } from 'vitest';
import { readIntakeDraft } from '../../../src/case/intake.js';
import { readAnthropicApiKey } from '../../../src/config.js';
import { claudeExtractor } from '../../../src/intake/claude-extractor.js';
import { type Extractor, ExtractorError } from '../../../src/intake/extractor.js';
import { intakeModel } from '../../../src/intake/model.js';
import { intakePromptVersion } from '../../../src/intake/prompt.js';
import { maxCallsPerRun, withCallLimit } from './call-limit.js';
import { type IntakeCase, intakeCases, writerAccount } from './cases.js';
import { type Baseline, type CaseRun, judge, report } from './report.js';
import { forbiddenIn, scoreDraft } from './score.js';

const concurrency = 4;

async function runCase(extractor: Extractor, evalCase: IntakeCase): Promise<CaseRun> {
  const sent: string[] = [];
  const watched: Extractor = {
    draft: (masked, known) => {
      sent.push(masked);
      return extractor.draft(masked, known);
    },
  };
  let draft: IntakeDraft = { people: [], relationships: [] };
  let failure: string | undefined;
  try {
    draft = await readIntakeDraft(watched, evalCase.text, evalCase.people, writerAccount);
  } catch (error) {
    // Only the vendor's failures are tolerated; anything else is a bug in the path and fails the run.
    if (!(error instanceof ExtractorError)) throw error;
    failure = error.code;
  }
  const score = scoreDraft(draft, evalCase.expected, new Set(evalCase.unscoredRoles));
  return {
    id: evalCase.id,
    score,
    forbidden: forbiddenIn(score, evalCase.forbidden ?? []),
    leaked: (evalCase.neverSent ?? []).filter((secret) =>
      sent.some((text) => text.includes(secret)),
    ),
    ...(failure === undefined ? {} : { failure }),
  };
}

it('scores the intake extraction against the baseline', async () => {
  const apiKey = readAnthropicApiKey();
  if (apiKey === undefined) throw new Error('Set ANTHROPIC_API_KEY to run the intake evaluation');
  const { extractor, calls } = withCallLimit(claudeExtractor({ apiKey }));

  const runs: CaseRun[] = [];
  const queue = [...intakeCases.entries()];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        const [index, evalCase] = item;
        runs[index] = await runCase(extractor, evalCase);
      }
    }),
  );

  const baseline = JSON.parse(
    readFileSync(new URL('baseline.json', import.meta.url), 'utf8'),
  ) as Baseline;
  const verdict = judge(runs, baseline);
  const scored = report(runs, baseline, verdict, {
    model: intakeModel,
    promptVersion: intakePromptVersion,
  });
  const text = `${scored}\n\nModel calls: ${String(calls())} of at most ${String(maxCallsPerRun)}.`;
  console.log(text);
  const summary = process.env['ARCA_EVAL_REPORT'];
  if (summary !== undefined && summary !== '') appendFileSync(summary, `${text}\n`);
  expect(verdict.problems).toEqual([]);
});
