/**
 * The model the independent check calls (ADR-0027): a strong one that differs from the one the
 * authoring sessions write rules with. Kept in reviewed code, never in a deployment setting; a change
 * runs the independent check evaluation and lands only after two passing runs on one commit.
 */
export const ruleCheckModel = 'claude-sonnet-5-5';

/**
 * The model that picks which passages of a long page the check reads (ADR-0027): a fast, cheap
 * one, since choosing from an outline is classification. A change is held to the same two runs
 * and bumps `ruleCheckPromptVersion`, which a report is stored under, so reports made with the
 * model before stop counting as current.
 */
export const passageLocateModel = 'claude-haiku-5-5';
