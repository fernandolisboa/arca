import { describe, expect, it } from 'vitest';
import { checkFold } from '../src/knowledge/check-fold.js';

describe('checkFold', () => {
  it.each([
    { name: 'loading', pending: true, status: undefined, key: 'loading', defaultOpen: true },
    {
      name: 'failed to load or check off',
      pending: false,
      status: undefined,
      key: 'loaded',
      defaultOpen: true,
    },
    { name: 'checked', pending: false, status: 'checked', key: 'loaded', defaultOpen: false },
    { name: 'flagged', pending: false, status: 'flagged', key: 'loaded', defaultOpen: true },
    { name: 'running', pending: false, status: 'running', key: 'loaded', defaultOpen: true },
    { name: 'stale', pending: false, status: 'stale', key: 'loaded', defaultOpen: true },
    { name: 'never checked', pending: false, status: 'none', key: 'loaded', defaultOpen: true },
  ] as const)('$name: key $key, open $defaultOpen', ({ pending, status, key, defaultOpen }) => {
    expect(checkFold(pending, status)).toEqual({ key, defaultOpen });
  });

  it('keeps the key once loaded, so a check finishing during the visit does not fold the panel', () => {
    expect(checkFold(false, 'running').key).toBe(checkFold(false, 'checked').key);
  });
});
