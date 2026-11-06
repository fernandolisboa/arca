import type { QuestionId, Sentence } from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { casePlaybackQuery } from '../api.js';
import { useNames } from './editors.js';
import { percentFromShare } from './entry.js';
import { formatAmount, formatDateValue } from './format.js';

/** Words each sentence through i18n, with the viewer's names for the people it is about. */
export function useSentenceText(names: ReadonlyMap<string, string>) {
  const { t, i18n } = useTranslation();
  const labels = useNames();
  const name = (id: string) => names.get(id) ?? '';
  const date = (value: string) => formatDateValue(value, i18n.language);
  const list = (items: readonly string[]) =>
    new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(items);
  const when = (key: 'since' | 'until' | 'in' | 'startSince' | 'sold', value?: string) =>
    value === undefined || value === 'none' ? '' : t(`playback.part.${key}`, { date: date(value) });
  return (said: Sentence): string => {
    switch (said.kind) {
      case 'profileHidden':
      case 'financesHidden':
      case 'noCitizenship':
      case 'noLanguage':
      case 'noJobOffer':
      case 'noImmigrationEvent':
      case 'noIncome':
      case 'independent':
        return t(`playback.sentence.${said.kind}`, { person: name(said.person) });
      case 'unanswered':
        return t('playback.sentence.unanswered', {
          question:
            said.question === undefined
              ? ''
              : t(`questions.asked.${said.question}`, { name: name(said.person) }),
        });
      case 'born':
        return t('playback.sentence.born', {
          person: name(said.person),
          date: date(said.date),
          age:
            said.age === undefined
              ? ''
              : said.age.min === said.age.max
                ? t('playback.part.age', { min: said.age.min })
                : t('playback.part.ageRange', said.age),
        });
      case 'citizenship':
        return t('playback.sentence.citizenship', {
          person: name(said.person),
          country: labels.country(said.country),
          details: [
            said.basis === undefined ? '' : t('playback.part.basis', { basis: said.basis }),
            when('since', said.acquired),
            when('until', said.lost),
          ].join(''),
        });
      case 'residence':
        return t('playback.sentence.residence', {
          person: name(said.person),
          country: labels.country(said.country),
        });
      case 'education':
        return t('playback.sentence.education', {
          person: name(said.person),
          level: t('questions.choice.educationLevel', { value: String(said.level) }),
        });
      case 'studying':
        return t('playback.sentence.studying', {
          person: name(said.person),
          studying: said.studying ? 'yes' : 'no',
        });
      case 'language':
        return t('playback.sentence.language', {
          person: name(said.person),
          language: labels.language(said.language),
          level: t('questions.choice.languageLevel', { value: said.level }),
        });
      case 'jobOffer':
        return t('playback.sentence.jobOffer', {
          person: name(said.person),
          country: labels.country(said.country),
          sector: t('questions.choice.isicSection', { value: said.sector }),
          temporary: said.temporary ? t('playback.part.temporary') : '',
        });
      case 'immigrationEvent':
        return t('playback.sentence.immigrationEvent', {
          person: name(said.person),
          event: t('questions.choice.immigrationEvent', { value: said.event }),
          country: labels.country(said.country),
          date: when('in', said.date),
        });
      case 'dependsOn':
        return t('playback.sentence.dependsOn', {
          person: name(said.person),
          people: list(said.on.map(name)),
        });
      case 'recordedInFull':
        return t('playback.sentence.recordedInFull', {
          person: name(said.person),
          marker: said.marker,
        });
      case 'income':
        return t('playback.sentence.income', {
          person: name(said.person),
          amount: formatAmount(said.monthly, i18n.language),
          income: said.income,
          country: labels.country(said.sourceCountry),
        });
      case 'couple': {
        const ended = said.end !== undefined && said.end !== 'none';
        const people = {
          couple: said.couple,
          first: name(said.people[0]),
          second: name(said.people[1]),
          start: when('startSince', said.start),
        };
        return ended && said.end !== undefined
          ? t('playback.sentence.coupleEnded', { ...people, end: date(said.end) })
          : t('playback.sentence.couple', people);
      }
      case 'parent':
        return t('playback.sentence.parent', {
          parent: name(said.parent),
          child: name(said.child),
          details: [
            said.parentKind === undefined
              ? ''
              : t('playback.part.parentKind', { parentKind: said.parentKind }),
            said.custody === undefined ? '' : t('playback.part.custody', { custody: said.custody }),
            when('since', said.start),
          ].join(''),
        });
      case 'asset':
        return t('playback.sentence.asset', {
          asset: t('questions.choice.assetKind', { value: said.asset }),
          owners: list(
            said.owners.map((owner) =>
              t('playback.part.owner', {
                person: name(owner.person),
                share: percentFromShare(owner.share),
              }),
            ),
          ),
          value: formatAmount(said.value, i18n.language),
          valuedAt: date(said.valuedAt),
          sold: when('sold', said.sold),
        });
    }
  };
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
      <h3 className="font-display text-lead">{title}</h3>
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
