import { correctionItemKinds } from '@arca/domain';
import { correctionItemKinds as storedKinds } from '@arca/db/knowledge-schema';
import { describe, expect, it } from 'vitest';

describe('correction request item kinds (ADR-0029)', () => {
  it('are the ones the database accepts, so no valid request fails on insert', () => {
    expect([...correctionItemKinds]).toEqual([...storedKinds]);
  });
});
