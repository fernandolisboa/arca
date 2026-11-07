/**
 * Text framed as data for a model: angle brackets become look-alikes, so nothing in it can close
 * or open a delimiter of the prompt. Each character is replaced in place, so the text keeps its
 * length and every offset in it holds. Every prompt frames untrusted text this way; the independent
 * check also verifies its quotes against page text in this form.
 */
export function asDataText(text: string): string {
  return text.replace(/</gu, '‹').replace(/>/gu, '›');
}
