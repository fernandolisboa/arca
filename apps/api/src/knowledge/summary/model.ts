/**
 * The model the rule summary calls (ADR-0025): a strong one, since pointing at what to check in a
 * rule is judgment rather than extraction. Kept in reviewed code, never in a deployment setting; a
 * change runs the rule summary evaluation and lands only if it passes.
 */
export const ruleSummaryModel = 'claude-sonnet-5-5';
