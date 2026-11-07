import { useId } from 'react';
import type { KnowledgeWords } from './words.js';

/** The surface of one item under review, and the card that lays one out. */
export const surface = 'rounded-control border border-line bg-surface p-4';
export const card = `flex min-w-0 flex-col gap-2 ${surface}`;

/** IDs added, removed or changed in one section since the version before. */
export interface SectionChange {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}

/** One line for a section that changed, none for one that did not. */
export function changeLine(
  section: string,
  change: SectionChange,
  words: KnowledgeWords,
  items: (ids: readonly string[]) => string = words.list,
): readonly string[] {
  const details = [
    ...(change.added.length > 0
      ? [words.t('knowledge.changeAdded', { items: items(change.added) })]
      : []),
    ...(change.removed.length > 0
      ? [words.t('knowledge.changeRemoved', { items: items(change.removed) })]
      : []),
    ...(change.changed.length > 0
      ? [words.t('knowledge.changeChanged', { items: items(change.changed) })]
      : []),
  ];
  return details.length === 0
    ? []
    : [words.t('knowledge.change', { section, details: words.list(details) })];
}

/** What changed since the version a version replaces, or that its content is the same. */
export function ChangeList({
  number,
  lines,
  words,
}: {
  readonly number: number;
  readonly lines: readonly string[];
  readonly words: KnowledgeWords;
}) {
  if (lines.length === 0) return <p>{words.t('knowledge.noChanges', { number })}</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted">{words.t('knowledge.changesSince', { number })}</p>
      <ul className="flex flex-col gap-2">
        {lines.map((line) => (
          <li key={line} className={card}>
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The independent-check note and the content hash, read before deciding. */
export function CheckAndHash({
  hash,
  words,
}: {
  readonly hash: string;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const checkId = useId();
  return (
    <>
      <section aria-labelledby={checkId} className={card}>
        <h5 id={checkId} className="font-medium">
          {t('knowledge.check.title')}
        </h5>
        <p>{t('knowledge.check.body')}</p>
      </section>
      <div className="flex flex-col gap-1">
        <p className="text-small text-muted">{t('knowledge.hash')}</p>
        <p className="font-mono text-small break-all">{hash}</p>
      </div>
    </>
  );
}
