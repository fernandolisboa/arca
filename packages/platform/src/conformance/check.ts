/** One conformance case: runs in Vitest against fakes and in a real browser against adapters. */
export interface ConformanceCase {
  readonly name: string;
  readonly run: () => Promise<void>;
}

export class ConformanceFailure extends Error {
  override name = 'ConformanceFailure';
}

export function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ConformanceFailure(message);
}

/** Compares by error name, so it holds across realms and bundles. */
export async function rejectsWith(action: () => unknown, errorName: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    check(
      error instanceof Error && error.name === errorName,
      `expected ${errorName}, got ${error instanceof Error ? error.name : String(error)}`,
    );
    return;
  }
  throw new ConformanceFailure(`expected ${errorName}, but it succeeded`);
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}
