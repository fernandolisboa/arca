import type { Shape } from './shapes.js';

/** The exported shape of a Sentry event, breadcrumb or CSP report: plain JSON, nothing more. */
export type Scrubbed = Readonly<Record<string, unknown>>;

/** Turns an untrusted value into what may be exported, or undefined to drop it. */
export type Rule = (value: unknown) => unknown;

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const keep =
  (shape: Shape): Rule =>
  (value) =>
    shape(value) ? value : undefined;

/** A fresh object with only the listed fields; every other field is dropped. */
export const object =
  (rules: Readonly<Record<string, Rule>>): Rule =>
  (value) => {
    if (!isRecord(value)) return undefined;
    const kept: Record<string, unknown> = {};
    for (const [field, rule] of Object.entries(rules)) {
      if (!Object.hasOwn(value, field)) continue;
      const result = rule(value[field]);
      if (result !== undefined) kept[field] = result;
    }
    return kept;
  };

/** The last `max` entries that pass, so a flood cannot grow an export without bound. */
export const list =
  (rule: Rule, max: number): Rule =>
  (value) =>
    Array.isArray(value)
      ? value
          .slice(-max)
          .map(rule)
          .filter((entry) => entry !== undefined)
      : undefined;
