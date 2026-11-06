import { appendFileSync, readFileSync } from 'node:fs';
import type { IntakeDraft } from '@arca/domain';
import { expect, it } from 'vitest';
import { readIntakeDraft } from '../../../src/case/intake.js';
import { readAnthropicApiKey, readScriptedIntake } from '../../../src/config.js';
import { claudeExtractor } from '../../../src/intake/claude-extractor.js';
import { type Extractor, ExtractorError } from '../../../src/intake/extractor.js';
import { intakeModel } from '../../../src/intake/model.js';
import { intakePromptVersion } from '../../../src/intake/prompt.js';
import { type IntakeCase, intakeCases, writerAccount } from './cases.js';
import { type Baseline, type CaseRun, judge, report } from './report.js';
import { scoreDraft } from './score.js';

/**
 * The intake evaluation (spec 0008, R5): every case through the same path the draft route takes,
 * against the Claude adapter, scored and judged against the baseline. It refuses to run without
 * a key or on the scripted extractor, since a score of either would say nothing about the model.
 */

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
    failure = error instanceof ExtractorError ? error.code : 'intake_failed';
  }
  return {
    id: evalCase.id,
    score: scoreDraft(draft, evalCase.expected, new Set(evalCase.unscoredRoles)),
    leaked: (evalCase.neverSent ?? []).filter((secret) =>
      sent.some((text) => text.includes(secret)),
    ),
    ...(failure === undefined ? {} : { failure }),
  };
}

it('scores the intake extraction against the baseline', async () => {
  if (readScriptedIntake()) {
    throw new Error('ARCA_INTAKE_EXTRACTOR=scripted is set: the evaluation needs the real model');
  }
  const apiKey = readAnthropicApiKey();
  if (apiKey === undefined) throw new Error('Set ANTHROPIC_API_KEY to run the intake evaluation');
  const extractor = claudeExtractor({ apiKey });

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
  const text = report(runs, baseline, verdict, {
    model: intakeModel,
    promptVersion: intakePromptVersion,
  });
  console.log(text);
  const summary = process.env['ARCA_EVAL_REPORT'];
  if (summary !== undefined && summary !== '') appendFileSync(summary, `${text}\n`);
  expect(verdict.problems).toEqual([]);
});
