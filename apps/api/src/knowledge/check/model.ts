/**
 * The model the independent check calls (ADR-0027): a strong one that differs from the one the
 * authoring sessions write rules with. Kept in reviewed code, never in a deployment setting; a change
 * runs the independent check evaluation and lands only after two passing runs on one commit.
 */
export const ruleCheckModel = 'claude-sonnet-5-5';
