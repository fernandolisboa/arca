// No third-party imports: setup-pnpm.ts uses this before pnpm exists.

export interface Violation {
  readonly where: string;
  readonly problem: string;
}

export function reportViolations(violations: readonly Violation[]): void {
  for (const { where, problem } of violations)
    console.error(`${oneLine(where)}: ${oneLine(problem)}`);
  process.exitCode = violations.length > 0 ? 1 : 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Keeps reported text on one line and out of the Actions runner's `::command::` syntax, since it
 * may quote files from a pull request.
 */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/:(?=:)/g, ': ');
}
