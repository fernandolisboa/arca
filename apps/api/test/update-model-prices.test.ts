import { aiStageOptions, aiStages } from '@arca/api-contract/routes';
import { describe, expect, it } from 'vitest';
import { updateModelPrices } from '../src/knowledge/update/prices.js';

describe("an update request's model prices (ADR-0031)", () => {
  it('prices every model settings offer, so no cost shows as unknown', () => {
    const offered = aiStages.flatMap((stage) => [...aiStageOptions[stage].models]);
    expect(offered.filter((model) => !updateModelPrices.has(model))).toEqual([]);
  });
});
