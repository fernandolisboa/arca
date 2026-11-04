import { ApiError } from '@arca/api-contract/client';
import { describe, expect, it } from 'vitest';
import { isExpectedFailure } from '../src/monitoring.js';
import { UnreachableError } from '../src/requests.js';

describe('which browser errors are reported (spec 0004, R5)', () => {
  it.each([
    ['a refusal from the API', new ApiError(403, 'step_up_required'), true],
    ['a lost connection', new UnreachableError(), true],
    ['an API failure', new ApiError(503, 'internal_error'), false],
    ['a bug', new TypeError('x is undefined'), false],
    ['a thrown value', 'boom', false],
  ])('treats %s as expected: %s', (_, error, expected) => {
    expect(isExpectedFailure(error)).toBe(expected);
  });
});
