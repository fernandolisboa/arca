import { describe, expect, it } from 'vitest';
import { comparisonIdentityKey } from '../../src/comparison/select.js';
import { type DecisionState, identityKey } from '../../src/rules/catalog.js';
import {
  type CheckedDecision,
  type DecisionKind,
  decisionStates,
} from '../../src/rules/decisions.js';

const one = { routeId: 'qm-sample', number: 1, hash: 'a'.repeat(64) };
const other = { ...one, hash: 'b'.repeat(64) };

const decided = (kind: DecisionKind, verified: boolean, identity = one): CheckedDecision => ({
  subject: 'route',
  kind,
  identity,
  verified,
});

const comparison = { comparisonId: 'destinations', number: 1, hash: 'a'.repeat(64) };

const comparisonDecided = (kind: DecisionKind, verified: boolean): CheckedDecision => ({
  subject: 'comparison',
  kind,
  identity: comparison,
  verified,
});

describe('decision states (spec 0007, R7)', () => {
  it.each<[string, readonly CheckedDecision[], DecisionState | undefined]>([
    ['no decision leaves it proposed', [], undefined],
    ['a verified activation activates', [decided('activate', true)], 'active'],
    ['an unverified activation counts for nothing', [decided('activate', false)], undefined],
    ['a verified rejection rejects', [decided('reject', true)], 'rejected'],
    ['an unverified rejection still rejects', [decided('reject', false)], 'rejected'],
    [
      'a rejection after an activation wins',
      [decided('activate', true), decided('reject', true)],
      'rejected',
    ],
    [
      'an activation after a rejection does not bring it back',
      [decided('reject', false), decided('activate', true)],
      'rejected',
    ],
    [
      'a forged activation next to a real one keeps it active',
      [decided('activate', false), decided('activate', true)],
      'active',
    ],
    [
      'a decision on other content leaves this one proposed',
      [decided('activate', true, other), decided('reject', true, other)],
      undefined,
    ],
  ])('%s', (_, decisions, state) => {
    expect(decisionStates(decisions).get(identityKey(one))).toBe(state);
  });

  it('keys each state by the exact content decided', () => {
    const states = decisionStates([decided('activate', true), decided('reject', false, other)]);
    expect([...states]).toEqual([
      [identityKey(one), 'active'],
      [identityKey(other), 'rejected'],
    ]);
  });

  it('keeps decisions on a comparison version apart from route versions (ADR-0026)', () => {
    const lookalike = { routeId: 'destinations', number: 1, hash: 'a'.repeat(64) };
    const states = decisionStates([
      comparisonDecided('activate', true),
      decided('reject', true, lookalike),
    ]);
    expect(states.get(comparisonIdentityKey(comparison))).toBe('active');
    expect(states.get(identityKey(lookalike))).toBe('rejected');
    expect(states.size).toBe(2);
  });

  it.each<[string, readonly CheckedDecision[], DecisionState | undefined]>([
    ['a verified activation activates', [comparisonDecided('activate', true)], 'active'],
    [
      'an unverified activation counts for nothing',
      [comparisonDecided('activate', false)],
      undefined,
    ],
    [
      'a rejection wins over an activation',
      [comparisonDecided('activate', true), comparisonDecided('reject', false)],
      'rejected',
    ],
  ])('comparison: %s', (_, decisions, state) => {
    expect(decisionStates(decisions).get(comparisonIdentityKey(comparison))).toBe(state);
  });
});
