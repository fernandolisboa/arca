import { describe, expect, it } from 'vitest';
import { fakeExtractor } from '../src/intake/fake-extractor.js';

// The scripted extractor the e2e build drafts with (spec 0008, R4). Synthetic text only.
describe('the scripted extractor', () => {
  it.each([
    [
      'Minha filha nasceu em 2015 e é italiana.',
      ['[P1]', '[P2]'],
      { birthDate: '2015', citizenships: ['IT'] },
    ],
    ['Tenho uma filha.', ['[P1]'], {}],
  ] as const)('drafts a child of the writer from %j', async (text, known, child) => {
    const { reply, model } = await fakeExtractor.draft(text, known, '[P1]');
    expect(model).toBe('fake');
    expect(reply).toEqual({
      people: [...known.map((ref) => ({ ref })), { ref: 'n2', role: 'child', ...child }],
      relationships: [{ kind: 'parent', parent: '[P1]', child: 'n2' }],
    });
  });

  it('drafts the writer as someone new when no placeholder names them', async () => {
    const { reply } = await fakeExtractor.draft('Tenho uma filha.', []);
    expect(reply).toEqual({
      people: [
        { ref: 'n1', role: 'self' },
        { ref: 'n2', role: 'child' },
      ],
      relationships: [{ kind: 'parent', parent: 'n1', child: 'n2' }],
    });
  });
});
