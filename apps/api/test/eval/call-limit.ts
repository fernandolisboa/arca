// What bounds an AI evaluation run's cost: a count of model calls that refuses one past its limit.

export class CallLimitReached extends Error {
  override name = 'CallLimitReached';
}

/** Counts a run's model calls; `take` counts one before it is sent and refuses any past `limit`. */
export function callCounter(limit: number) {
  let calls = 0;
  return {
    take() {
      if (calls >= limit) throw new CallLimitReached(`The run reached its ${String(limit)} calls`);
      calls += 1;
    },
    calls: () => calls,
  };
}
