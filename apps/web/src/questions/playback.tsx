import type { QuestionId, Sentence } from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { casePlaybackQuery } from '../api.js';
import { useNames } from './editors.js';
import { type SentenceWords, sentenceText } from './sentences.js';

/** Words each sentence with the viewer's names and the screen's language. */
function useSentenceText(names: ReadonlyMap<string, string>) {
  const { t, i18n } = useTranslation();
  const labels = useNames();
  const words: SentenceWords = {
    t,
    language: i18n.language,
    name: (id) => names.get(id) ?? '',
    country: labels.country,
    languageName: labels.language,
  };
  return (said: Sentence) => sentenceText(words, said);
}

const relationshipsKey = 'relationships';
const assetsKey = 'assets';

const sentenceClass =
  'min-h-touch w-full rounded-control px-2 py-1 text-left underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * The case read back (spec 0007, R5): each person's sentences, then the relationships and the
 * assets. A sentence about someone the viewer keeps opens its question.
 */
export function CaseSummary({
  people,
  kept,
  onPick,
}: {
  readonly people: readonly { readonly id: string; readonly displayName: string }[];
  readonly kept: ReadonlySet<string>;
  readonly onPick: (personId: string, question: QuestionId) => void;
}) {
  const { t } = useTranslation();
  const names = new Map(people.map(({ id, displayName }) => [id, displayName]));
  const text = useSentenceText(names);
  const playback = useQuery(casePlaybackQuery);
  if (playback.isError) {
    return (
      <div className="flex flex-col gap-3">
        <p>{t('playback.loadFailure')}</p>
        <Button onClick={() => void playback.refetch()}>{t('questions.retry')}</Button>
      </div>
    );
  }
  if (playback.data === undefined) return null;
  const { sentences } = playback.data;
  const line = (said: Sentence, index: number) => {
    const target = said.about.find((id) => kept.has(id));
    const words = text(said);
    return (
      <li key={index}>
        {target === undefined || said.question === undefined ? (
          <p className="px-2 py-1">{words}</p>
        ) : (
          <button
            type="button"
            className={sentenceClass}
            onClick={() => {
              if (said.question !== undefined) onPick(target, said.question);
            }}
          >
            {words}
          </button>
        )}
      </li>
    );
  };
  const section = (title: string, said: readonly Sentence[], key: string) => (
    <section key={key} className="flex flex-col gap-2" aria-label={title}>
      <h4 className="font-medium">{title}</h4>
      {said.length === 0 ? (
        <p className="px-2 text-muted">{t('playback.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">{said.map(line)}</ul>
      )}
    </section>
  );
  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted">{t('playback.lead')}</p>
      {people.map(({ id, displayName }) =>
        section(
          displayName,
          sentences.filter((said) => 'person' in said && said.person === id),
          id,
        ),
      )}
      {section(
        t('playback.relationships'),
        sentences.filter(({ kind }) => kind === 'couple' || kind === 'parent'),
        relationshipsKey,
      )}
      {section(
        t('playback.assets'),
        sentences.filter(({ kind }) => kind === 'asset'),
        assetsKey,
      )}
    </div>
  );
}
