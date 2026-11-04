import { isRecord, keep, list, object, type Rule, type Scrubbed } from './rules.js';
import { integer, oneOf } from './shapes.js';
import { blockedKeyword, type UrlReducer } from './urls.js';

/** The directives a policy can name, so a report's directive is never free text. */
const directive = keep(
  oneOf([
    'base-uri',
    'child-src',
    'connect-src',
    'default-src',
    'fenced-frame-src',
    'font-src',
    'form-action',
    'frame-ancestors',
    'frame-src',
    'img-src',
    'manifest-src',
    'media-src',
    'object-src',
    'require-trusted-types-for',
    'sandbox',
    'script-src',
    'script-src-attr',
    'script-src-elem',
    'style-src',
    'style-src-attr',
    'style-src-elem',
    'trusted-types',
    'upgrade-insecure-requests',
    'worker-src',
  ]),
);

/**
 * CSP and Trusted Types violation reports from the Reporting API, with their own allow-list
 * (spec 0004, R3, R5): the directive, where it happened and what was blocked, reduced like any
 * URL. The sample, the referrer and the policy text are always dropped.
 */
export function cspScrubber(reduce: UrlReducer) {
  const blocked: Rule = (value) => (blockedKeyword(value) ? value : reduce(value));

  const report = object({
    type: keep(oneOf(['csp-violation'])),
    age: keep(integer),
    url: reduce,
    body: object({
      documentURL: reduce,
      blockedURL: blocked,
      effectiveDirective: directive,
      disposition: keep(oneOf(['enforce', 'report'])),
      statusCode: keep(integer),
      sourceFile: reduce,
      lineNumber: keep(integer),
      columnNumber: keep(integer),
    }),
  });
  const reports = list(report, 20);
  const isViolation = (value: unknown) => isRecord(value) && value['type'] === 'csp-violation';

  /** Other report types share the batch, so violations are picked out before the cap applies. */
  return (payload: unknown): readonly Scrubbed[] =>
    Array.isArray(payload) ? (reports(payload.slice(-200).filter(isViolation)) as Scrubbed[]) : [];
}
