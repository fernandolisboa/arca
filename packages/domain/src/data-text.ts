/**
 * Text framed as data for a model: angle brackets become look-alikes, so nothing in it can close
 * or open a delimiter of the prompt. The independent check sends a page's text, and checks its
 * quotes, in this form.
 */
export function asDataText(text: string): string {
  return text.replace(/</gu, '‹').replace(/>/gu, '›');
}
