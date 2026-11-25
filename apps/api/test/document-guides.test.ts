import { createHash } from 'node:crypto';
import { ptBR } from '@arca/i18n/catalog';
import { documentGuideWordingSha256, documentGuides } from '@arca/knowledge';
import { describe, expect, it } from 'vitest';

type Wording = typeof ptBR.documentGuide;

const sha256 = (wording: Wording) =>
  createHash('sha256').update(JSON.stringify(wording)).digest('hex');

/**
 * Where the catalog's guide wording and the guide file disagree (ADR-0039): an entry the catalog
 * does not word, wording for an entry the file does not list, or wording the file's hash does not
 * pin. With no file, the catalog words nothing.
 */
function wordingProblems(
  entries: readonly { readonly country: string; readonly kind: string }[],
  pinnedSha256: string | null,
  wording: Wording,
): string[] {
  const listed = new Set(entries.map(({ country, kind }) => `${country}/${kind}`));
  const unworded = entries
    .filter(
      ({ country, kind }) => !wording[country]?.[kind]?.office || !wording[country][kind].request,
    )
    .map(({ country, kind }) => `${country}/${kind} has no office or request wording`);
  const unlisted = Object.entries(wording)
    .flatMap(([country, kinds]) => Object.keys(kinds).map((kind) => `${country}/${kind}`))
    .filter((key) => !listed.has(key))
    .map((key) => `${key} is worded but not in the file`);
  const hash =
    pinnedSha256 === null || pinnedSha256 === sha256(wording)
      ? []
      : ['the wording differs from what the file pins'];
  return [...unworded, ...unlisted, ...hash];
}

describe('the document guides’ wording (ADR-0039)', () => {
  it('is the wording the repository file pins, entry for entry', () => {
    expect(wordingProblems(documentGuides, documentGuideWordingSha256, ptBR.documentGuide)).toEqual(
      [],
    );
  });

  describe('on a synthetic guide', () => {
    const entries = [{ country: 'BR', kind: 'birth_certificate' }];
    const wording: Wording = {
      BR: { birth_certificate: { office: 'Cartório sintético', request: 'Peça no balcão.' } },
    };

    it('accepts wording that matches the file and its hash', () => {
      expect(wordingProblems(entries, sha256(wording), wording)).toEqual([]);
    });

    it('fails when the wording hash differs', () => {
      const changed: Wording = {
        BR: { birth_certificate: { office: 'Cartório sintético', request: 'Peça on-line.' } },
      };
      expect(wordingProblems(entries, sha256(wording), changed)).toEqual([
        'the wording differs from what the file pins',
      ]);
    });

    it('fails when the file lists an entry the catalog does not word', () => {
      const more = [...entries, { country: 'BR', kind: 'criminal_record' }];
      expect(wordingProblems(more, sha256(wording), wording)).toEqual([
        'BR/criminal_record has no office or request wording',
      ]);
    });

    it('fails when the catalog words an entry the file does not list', () => {
      expect(wordingProblems([], sha256(wording), wording)).toEqual([
        'BR/birth_certificate is worded but not in the file',
      ]);
    });

    it('fails when there is no file but the catalog words an entry', () => {
      expect(wordingProblems([], null, wording)).toEqual([
        'BR/birth_certificate is worded but not in the file',
      ]);
    });
  });
});
