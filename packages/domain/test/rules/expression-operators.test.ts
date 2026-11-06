import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { expressionOperators, expressionSchema } from '../../src/rules/expression.js';

describe('expressionOperators', () => {
  it('names every operator the schema accepts, and only those', () => {
    const union = (expressionSchema as z.ZodLazy).unwrap() as z.ZodDiscriminatedUnion<
      z.ZodObject<{ op: z.ZodLiteral<string> }>[]
    >;
    const accepted = union.options.map((option) => option.shape.op.value);
    expect([...expressionOperators].sort()).toEqual([...accepted].sort());
  });
});
