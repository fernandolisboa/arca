import { describe, expect, it } from 'vitest';
import { oneLine } from '../src/report.ts';

describe('report', () => {
  it('keeps quoted text on one line and out of workflow command syntax', () => {
    expect(oneLine('::add-mask::.yml')).toBe(': :add-mask: :.yml');
    expect(oneLine('a\n::error::x\r\n  b')).toBe('a : :error: :x b');
    expect(oneLine(':::')).not.toContain('::');
  });
});
