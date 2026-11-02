import { describe, expect, it, vi } from 'vitest';
import { runOptions, startWorkflow, type StartRun } from '../src/workflows/start-workflow.js';
import {
  entityId,
  InvalidWorkflowArgumentError,
  utcDate,
  type EntityId,
  type IsoDate,
} from '../src/workflows/workflow-arguments.js';

const someId = '0b9c3d6e-1f2a-4b5c-8d7e-9f0a1b2c3d4e';

function fakeStart() {
  const calls: unknown[][] = [];
  const startRun: StartRun = (workflow, args, options) => {
    calls.push([workflow, args, options]);
    return Promise.resolve({ runId: 'wrun_test' });
  };
  return { calls, startRun };
}

describe('startWorkflow (spec 0001, R6)', () => {
  it('starts every run in São Paulo with zero retention and returns its ID', async () => {
    const { calls, startRun } = fakeStart();
    const workflow = vi.fn<(id: EntityId, date: IsoDate) => Promise<void>>();
    const args: [EntityId, IsoDate] = [entityId(someId), utcDate(new Date(0))];

    await expect(startWorkflow(workflow, args, startRun)).resolves.toBe('wrun_test');
    expect(calls).toEqual([[workflow, args, { region: 'gru1', experimental_retention: 0 }]]);
    expect(runOptions).toEqual({ region: 'gru1', experimental_retention: 0 });
    expect(workflow).not.toHaveBeenCalled();
  });

  it('accepts identifiers and dates only', () => {
    const { startRun } = fakeStart();
    const byName = vi.fn<(name: string) => Promise<void>>();
    const byObject = vi.fn<(person: { name: string }) => Promise<void>>();
    const byId = vi.fn<(id: EntityId) => Promise<void>>();
    // Compile-time checks; the calls are never awaited.
    const rejected = () => [
      // @ts-expect-error a plain string could carry a name or a document number
      startWorkflow(byName, ['Maria'], startRun),
      // @ts-expect-error objects are not identifiers
      startWorkflow(byObject, [{ name: 'Maria' }], startRun),
      // @ts-expect-error an unchecked string is not an EntityId
      startWorkflow(byId, [someId], startRun),
    ];
    expect(rejected).toBeTypeOf('function');
  });
});

describe('workflow argument constructors', () => {
  it.each([someId, someId.toUpperCase()])('accepts the UUID %s', (value) => {
    expect(entityId(value)).toBe(value);
  });

  it.each(['', 'not-a-uuid', `${someId} `, `${someId}\n`, 'Maria Silva'])(
    'refuses %j as an identifier',
    (value) => {
      expect(() => entityId(value)).toThrow(InvalidWorkflowArgumentError);
    },
  );

  it.each([
    ['2026-11-02T23:59:59.999Z', '2026-11-02'],
    ['2026-11-03T00:00:00.000Z', '2026-11-03'],
    ['2026-11-02T22:30:00.000-03:00', '2026-11-03'],
  ])('takes the UTC date of %s', (at, expected) => {
    expect(utcDate(new Date(at))).toBe(expected);
  });
});
