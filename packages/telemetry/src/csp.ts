import { isRecord, keep, list, object, type Rule } from './rules.js';
import { integer, oneOf } from './shapes.js';
import { blockedKeyword, type UrlReducer } from './urls.js';

const directive = keep((value) => typeof value === 'string' && /^[a-z-]{1,40}$/.test(value));

/**
 * CSP and Trusted Types violation reports from the Reporting API, with their own allow-list
 * (spec 0004, R3, R5): the directive, where it happened and what was blocked, reduced like any
 * URL. The sample, the referrer and the policy text are always dropped.
 */
export function cspScrubber(reduce: UrlReducer) {
  const url: Rule = (value) => reduce(value);
  const blocked: Rule = (value) => (blockedKeyword(value) ? value : reduce(value));

  const report = object({
    type: keep(oneOf(['csp-violation'])),
    age: keep(integer),
    url,
    body: object({
      documentURL: url,
      blockedURL: blocked,
      effectiveDirective: directive,
      disposition: keep(oneOf(['enforce', 'report'])),
      statusCode: keep(integer),
      sourceFile: url,
      lineNumber: keep(integer),
      columnNumber: keep(integer),
    }),
  });
  const reports = list((value) => {
    const kept = report(value);
    return isRecord(kept) && kept['type'] === 'csp-violation' ? kept : undefined;
  }, 20);

  return (payload: unknown): readonly Readonly<Record<string, unknown>>[] =>
    (reports(payload) as Readonly<Record<string, unknown>>[] | undefined) ?? [];
}
