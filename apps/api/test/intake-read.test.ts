import { describe, expect, it } from 'vitest';
import { readIntakeDraft } from '../src/case/intake.js';
import type { Extractor } from '../src/intake/extractor.js';

// The path from a member's text to a draft in case IDs (spec 0008, R3). Synthetic names only.
const people = [
  { id: 'person-sara', displayName: 'Sara Nogueira', accountId: 'account-sara' },
  { id: 'person-tito', displayName: 'Tito Nogueira', accountId: null },
];

function replying(reply: unknown) {
  const calls: { masked: string; known: readonly string[]; writer?: string }[] = [];
  const extractor: Extractor = {
    draft: (masked, known, writer) => {
      calls.push({ masked, known, ...(writer === undefined ? {} : { writer }) });
      return Promise.resolve({ reply, model: 'claude-test', promptVersion: 'intake-test' });
    },
  };
  return { extractor, calls };
}

describe('readIntakeDraft', () => {
  it("sends the writer's placeholder, though the text does not name them, and maps it back", async () => {
    const { extractor, calls } = replying({
      people: [{ ref: '[P1]' }, { ref: 'n1', role: 'child', birthDate: '2016' }],
      relationships: [{ kind: 'parent', parent: '[P1]', child: 'n1' }],
    });
    const draft = await readIntakeDraft(
      extractor,
      'Tenho uma filha, nascida em 2016.',
      people,
      'account-sara',
    );
    expect(calls).toEqual([
      { masked: 'Tenho uma filha, nascida em 2016.', known: ['[P1]'], writer: '[P1]' },
    ]);
    expect(draft).toEqual({
      people: [{ ref: 'person-sara' }, { ref: 'n1', role: 'child', birthDate: '2016' }],
      relationships: [{ kind: 'parent', parent: 'person-sara', child: 'n1' }],
    });
  });

  it('names no writer when the viewer has no person in the case', async () => {
    const { extractor, calls } = replying({ people: [], relationships: [] });
    await readIntakeDraft(extractor, 'O Tito nasceu em 1990.', people, 'account-other');
    expect(calls).toEqual([{ masked: 'O [P2] nasceu em 1990.', known: ['[P2]'] }]);
  });
});
