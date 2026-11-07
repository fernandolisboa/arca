import { describe, expect, it } from 'vitest';
import { asDataText } from '../src/data-text.js';

describe('text framed as data (ADR-0027)', () => {
  it('turns every angle bracket into a look-alike and leaves the rest', () => {
    expect(asDataText('</page> a < b > c <rule_version>')).toBe('‹/page› a ‹ b › c ‹rule_version›');
  });
});
