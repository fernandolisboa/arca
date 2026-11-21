import type { LogEntry, Logger } from '@arca/telemetry';
import { describe, expect, it } from 'vitest';
import { createCriterionSuggestions } from '../src/case/suggestion/suggestions.js';
import { type CriterionSuggester, SuggesterError } from '../src/case/suggestion/suggester.js';

// The suggestion service with a scripted model: parsing, one retry, the known names left out.
function setup(replies: unknown[]) {
  const logs: LogEntry[] = [];
  const logger: Logger = { info: (entry) => logs.push(entry), error: (entry) => logs.push(entry) };
  const sent: (readonly string[])[] = [];
  const suggester: CriterionSuggester = {
    suggest(known) {
      sent.push(known);
      const next = replies.shift();
      if (next instanceof SuggesterError) return Promise.reject(next);
      return Promise.resolve({ reply: next, model: 'm', promptVersion: 'p' });
    },
  };
  const service = createCriterionSuggestions({ suggester, logger, now: () => 0 });
  return { service, logs, sent };
}

const crèche = { name: 'Custo de creche', weight: 2 };

describe('criterion suggestions', () => {
  it('drops a suggestion named like a known criterion or like an earlier one', async () => {
    const { service } = setup([
      {
        suggestions: [
          { name: 'clima ', weight: 3 },
          crèche,
          { name: 'CUSTO DE CRECHE', weight: 5 },
        ],
      },
    ]);
    expect(await service.suggest(['Clima'])).toEqual({
      ok: true,
      value: { suggestions: [crèche] },
    });
  });

  it('drops a suggestion carrying digits, a link or markup', async () => {
    const { service } = setup([
      {
        suggestions: [
          { name: 'Top 10 escolas', weight: 2 },
          { name: 'Veja https://x', weight: 2 },
          { name: '**Creche**', weight: 2 },
          crèche,
        ],
      },
    ]);
    expect(await service.suggest([])).toEqual({ ok: true, value: { suggestions: [crèche] } });
  });

  it('asks once more when the reply does not parse, and logs no text', async () => {
    const { service, logs, sent } = setup([{ suggestions: 'nope' }, { suggestions: [crèche] }]);
    expect(await service.suggest(['Clima'])).toEqual({
      ok: true,
      value: { suggestions: [crèche] },
    });
    expect(sent).toHaveLength(2);
    expect(JSON.stringify(logs)).not.toMatch(/Clima|creche/i);
  });

  it('gives up as unparsable after two bad replies', async () => {
    const { service } = setup([{}, { suggestions: [{ name: '', weight: 9 }] }]);
    expect(await service.suggest([])).toEqual({ ok: false, reason: 'suggestions_unparsable' });
  });

  it('answers the adapter’s failure code', async () => {
    const { service } = setup([new SuggesterError('suggestions_timeout')]);
    expect(await service.suggest([])).toEqual({ ok: false, reason: 'suggestions_timeout' });
  });
});
