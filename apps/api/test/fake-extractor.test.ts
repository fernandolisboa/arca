import { describe, expect, it } from 'vitest';
import { fakeExtractor } from '../src/intake/fake-extractor.js';

// The scripted extractor the e2e build drafts with (spec 0008, R4). Synthetic text only.
describe('the scripted extractor', () => {
  it.each([
    [
      'Minha filha nasceu em 2015 e é italiana.',
      ['[P2]'],
      { birthDate: '2015', citizenships: ['IT'] },
    ],
    ['Tenho uma filha.', [], {}],
  ] as const)('drafts the writer and a child from %j', async (text, known, child) => {
    const { reply, model } = await fakeExtractor.draft(text, known);
    expect(model).toBe('fake');
    expect(reply).toEqual({
      people: [
        ...known.map((ref) => ({ ref })),
        { ref: 'n1', role: 'self' },
        { ref: 'n2', role: 'child', ...child },
      ],
      relationships: [{ kind: 'parent', parent: 'n1', child: 'n2' }],
    });
  });
});
