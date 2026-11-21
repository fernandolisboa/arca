import {
  type ApiError,
  type DestinationComparison,
  ownCriteriaLimit,
  routes,
} from '@arca/api-contract/client';
import { Button, Icon, iconButtonClass } from '@arca/ui';
import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api } from '../api.js';
import { textLinkClass } from '../forms/text-link.js';
import { commonFailure, reach } from '../requests.js';
import type { Edit, Preferences } from './edits.js';
import { openSuggestions, readySuggestions, type Suggestion } from './suggestions.js';
import type { CompareWords } from './words.js';

const weights = [0, 1, 2, 3, 4, 5] as const;

const suggestionCodes = [
  'suggestions_unavailable',
  'suggestions_timeout',
  'suggestions_unparsable',
] as const;
type SuggestionCode = (typeof suggestionCodes)[number];
const isSuggestionCode = (code: string): code is SuggestionCode =>
  (suggestionCodes as readonly string[]).includes(code);

/** A suggestion and whether the Arca's model wrote it, which the row says. */
type Shown = Suggestion & { readonly fromArca: boolean };

/** What the person last did to a suggestion, until they undo it or do something else. */
interface LastStep {
  readonly kind: 'added' | 'dismissed';
  readonly name: string;
}

/**
 * Criteria the screen proposes, each with a starting weight the person may change: plus makes it
 * one of their own criteria, minus keeps it out of the suggestions, and the last step can be undone.
 */
export function SuggestionsPanel({
  criteria,
  preferences,
  change,
  words,
}: {
  readonly criteria: DestinationComparison['criteria'];
  readonly preferences: Preferences;
  readonly change: (edit: Edit) => void;
  readonly words: CompareWords;
}) {
  const { t } = words;
  const titleId = useId();
  const [last, setLast] = useState<LastStep>();
  const ready: readonly Shown[] = readySuggestions.map(({ id, weight }) => ({
    name: t(`compare.suggestion.${id}`),
    weight,
    fromArca: false,
  }));
  // Each answer adds to the earlier ones, so asking again never takes a suggestion away.
  const [fromArca, setFromArca] = useState<readonly Shown[]>([]);
  const asked = useMutation({
    mutationFn: async () => (await reach(api.call(routes.suggestCriteria, {}))).suggestions,
    networkMode: 'always',
    onSuccess: (suggestions) => {
      setFromArca((earlier) => [
        ...earlier,
        ...suggestions.map((each) => ({ ...each, fromArca: true })),
      ]);
    },
  });
  const open = openSuggestions([...ready, ...fromArca], {
    taken: [...criteria.map(words.label), ...preferences.ownCriteria.map(({ name }) => name)],
    dismissed: preferences.dismissed,
  });
  const failure = asked.isError
    ? commonFailure(asked.error, ({ code }: ApiError) =>
        isSuggestionCode(code) ? code : undefined,
      )
    : undefined;
  const full = preferences.ownCriteria.length >= ownCriteriaLimit;
  const undo = () => {
    if (last === undefined) return;
    change(
      last.kind === 'added'
        ? { kind: 'unadd', name: last.name }
        : { kind: 'undismiss', name: last.name },
    );
    setLast(undefined);
  };
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h4 id={titleId} className="font-medium">
          {t('compare.suggestionsTitle')}
        </h4>
        <p className="text-small text-muted">{t('compare.suggestionsLead')}</p>
      </div>
      <p role="status" className="flex flex-wrap items-center gap-x-3 text-small">
        {last !== undefined && (
          <>
            <span>{t('compare.suggestionDone', { kind: last.kind, name: last.name })}</span>
            <button
              type="button"
              className={`${textLinkClass} inline-flex items-center gap-1`}
              onClick={undo}
            >
              <Icon name="undo" size={16} />
              {t('compare.undo')}
            </button>
          </>
        )}
      </p>
      {full && (
        <p className="text-small text-muted">
          {t('compare.ownLimit', { max: String(ownCriteriaLimit) })}
        </p>
      )}
      {open.length === 0 && <p className="text-small text-muted">{t('compare.noSuggestions')}</p>}
      {open.length > 0 && (
        <ul className="grid gap-x-8 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
          {open.map((suggestion) => (
            <SuggestionRow
              key={suggestion.name}
              suggestion={suggestion}
              full={full}
              onAdd={(weight) => {
                change({ kind: 'add', name: suggestion.name, weight });
                setLast({ kind: 'added', name: suggestion.name });
              }}
              onDismiss={() => {
                change({ kind: 'dismiss', name: suggestion.name });
                setLast({ kind: 'dismissed', name: suggestion.name });
              }}
              words={words}
            />
          ))}
        </ul>
      )}
      <div className="flex flex-col items-start gap-2">
        <Button
          variant="secondary"
          disabled={asked.isPending}
          onClick={() => {
            asked.mutate();
          }}
        >
          <Icon name="ai" size={18} />
          {t(asked.isSuccess ? 'compare.suggestMore' : 'compare.suggest')}
        </Button>
        <p role="status" className="text-small text-muted">
          {asked.isPending
            ? t('compare.suggesting')
            : failure !== undefined
              ? t('compare.suggestFailure', { reason: failure })
              : asked.isSuccess && fromArca.length > 0
                ? t('compare.suggestNote')
                : ''}
        </p>
      </div>
    </section>
  );
}

function SuggestionRow({
  suggestion,
  full,
  onAdd,
  onDismiss,
  words,
}: {
  readonly suggestion: Shown;
  readonly full: boolean;
  readonly onAdd: (weight: number) => void;
  readonly onDismiss: () => void;
  readonly words: CompareWords;
}) {
  const { t } = words;
  const selectId = useId();
  const [weight, setWeight] = useState(suggestion.weight);
  const { name } = suggestion;
  return (
    <li className="flex items-center gap-2 border-b border-line py-1">
      <span className="min-w-0 flex-1 break-words">
        {name}
        {suggestion.fromArca && (
          <span className="ml-2 inline-flex items-center gap-1 align-middle text-caption text-muted">
            <Icon name="ai" size={12} />
            {t('compare.fromArca')}
          </span>
        )}
      </span>
      <label htmlFor={selectId} className="sr-only">
        {t('compare.suggestionWeight', { name })}
      </label>
      <select
        id={selectId}
        value={weight}
        onChange={(event) => {
          setWeight(Number(event.target.value));
        }}
        className="min-h-9 rounded-control border border-line bg-surface px-2 text-body text-ink tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {weights.map((each) => (
          <option key={each} value={each}>
            {t('compare.weightOf', { weight: String(each) })}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={`${iconButtonClass} hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50`}
        aria-label={t('compare.addSuggestion', { name })}
        disabled={full}
        onClick={() => {
          onAdd(weight);
        }}
      >
        <Icon name="add" />
      </button>
      <button
        type="button"
        className={`${iconButtonClass} hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50`}
        aria-label={t('compare.dismissSuggestion', { name })}
        onClick={onDismiss}
      >
        <Icon name="dismiss" />
      </button>
    </li>
  );
}
