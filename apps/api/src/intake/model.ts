/**
 * The model the Claude extractor calls (spec 0008, R1): a fast, cheap one, since extraction is
 * the kind of call CLAUDE.md routes to one. Kept in reviewed code, never in a deployment setting;
 * a change runs the intake evaluation and lands only if precision holds.
 */
export const intakeModel = 'claude-haiku-5-5';
