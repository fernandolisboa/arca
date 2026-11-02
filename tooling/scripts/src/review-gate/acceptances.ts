/** A row of docs/review-acceptances.md: one accepted medium finding for one pull request. */
export interface Acceptance {
  readonly pullRequest: number;
  readonly reviewer: string;
  readonly file: string;
  readonly category: string;
  readonly reason: string;
}

/**
 * Reads the acceptance table. A row counts only when it has a pull request number, reviewer, file,
 * category and a reason; anything else is ignored, so a malformed row accepts nothing.
 */
export function parseAcceptances(markdown: string): Acceptance[] {
  const rows: Acceptance[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const cells = tableCells(line);
    if (cells?.length !== 5) continue;
    const [pullRequestCell, reviewer, file, category, reason] = cells.map(plainCell) as [
      string,
      string,
      string,
      string,
      string,
    ];
    const pullRequest = /^#?(\d{1,9})$/.exec(pullRequestCell)?.[1];
    if (pullRequest === undefined || [reviewer, file, category, reason].includes('')) continue;
    rows.push({ pullRequest: Number(pullRequest), reviewer, file, category, reason });
  }
  return rows;
}

function tableCells(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return undefined;
  return trimmed
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replaceAll('\\|', '|'));
}

/** Drops a link around a pull request number and the backticks around a path or category. */
function plainCell(cell: string): string {
  const link = /^\[([^\]]*)\]\([^)]*\)$/.exec(cell);
  const text = link?.[1] ?? cell;
  return /^`[^`]*`$/.test(text) ? text.slice(1, -1) : text;
}
