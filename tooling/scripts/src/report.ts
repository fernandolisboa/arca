// No third-party imports: verify-pnpm.ts uses this before `pnpm install` has run.

export interface Violation {
  readonly where: string;
  readonly problem: string;
}

export function reportViolations(violations: readonly Violation[]): void {
  for (const { where, problem } of violations) console.error(`${where}: ${problem}`);
  process.exitCode = violations.length > 0 ? 1 : 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
