import {
  ownCriteriaLimit,
  ownCriterionNameLimit,
  type DestinationComparison,
} from '@arca/api-contract/client';
import { Button, ScaleChoice, cardClass } from '@arca/ui';
import { useId, useState, type SubmitEvent } from 'react';
import { dangerLinkClass, textLinkClass } from '../forms/text-link.js';
import { TextField } from '../forms/text-field.js';
import type { Edit, Preferences } from './edits.js';
import { measured, type CompareWords, type Criterion } from './words.js';

type Change = (edit: Edit) => void;

/** The panel's anchor, for the link that jumps to it on phones. */
export const weightsAnchor = 'weights';
/** Not only spaces: the API takes the name trimmed, and an empty one is refused. */
const notBlank = '.*\\S.*';

/** The person's weights, from 0 to 5, and the criteria they create, rename and delete. */
export function WeightsPanel({
  criteria,
  preferences,
  change,
  words,
}: {
  readonly criteria: DestinationComparison['criteria'];
  readonly preferences: Preferences;
  readonly change: Change;
  readonly words: CompareWords;
}) {
  const { t } = words;
  const titleId = useId();
  const objective = criteria.filter(measured);
  const personal = criteria.filter((criterion) => !measured(criterion));
  const group = (title: string, lead: string, items: readonly Criterion[]) =>
    items.length > 0 && (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h4 className="font-medium">{title}</h4>
          <p className="text-small text-muted">{lead}</p>
        </div>
        {items.map((criterion) => (
          <WeightRow
            key={criterion.id}
            criterion={criterion}
            weight={preferences.weights[criterion.id] ?? criterion.weight}
            change={change}
            words={words}
          />
        ))}
      </div>
    );
  return (
    <section
      id={weightsAnchor}
      aria-labelledby={titleId}
      className={`${cardClass} flex scroll-mt-20 flex-col gap-6 p-4 sm:p-5 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto`}
    >
      <div className="flex flex-col gap-1">
        <h3 id={titleId} className="font-display text-lead">
          {t('compare.weightsTitle')}
        </h3>
        <p className="text-small text-muted">{t('compare.weightsLead')}</p>
      </div>
      {group(t('compare.measuredTitle'), t('compare.measuredLead'), objective)}
      {group(t('compare.personalTitle'), t('compare.personalLead'), personal)}
      <AddCriterion count={preferences.ownCriteria.length} change={change} words={words} />
    </section>
  );
}

function WeightRow({
  criterion,
  weight,
  change,
  words,
}: {
  readonly criterion: Criterion;
  readonly weight: number;
  readonly change: Change;
  readonly words: CompareWords;
}) {
  const { t } = words;
  const [mode, setMode] = useState<'view' | 'rename' | 'remove'>('view');
  const label = words.label(criterion);
  if (criterion.kind === 'own' && mode === 'rename') {
    return (
      <NameForm
        label={t('compare.newName')}
        initial={criterion.name}
        submitLabel={t('compare.save')}
        onSubmit={(name) => {
          if (name !== criterion.name) change({ kind: 'rename', criterion: criterion.id, name });
          setMode('view');
        }}
        onCancel={() => {
          setMode('view');
        }}
        words={words}
      />
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <ScaleChoice
        legend={label}
        min={0}
        max={5}
        value={weight}
        onChange={(chosen) => {
          change({ kind: 'weight', criterion: criterion.id, weight: chosen });
        }}
      />
      {criterion.kind === 'own' &&
        (mode === 'remove' ? (
          <div role="group" aria-label={t('compare.removeLabel', { name: label })}>
            <p className="text-small">{t('compare.removeConfirm', { name: label })}</p>
            <div className="flex flex-wrap gap-x-6">
              <button
                type="button"
                className={dangerLinkClass}
                onClick={() => {
                  change({ kind: 'remove', criterion: criterion.id });
                  setMode('view');
                }}
              >
                {t('compare.remove')}
              </button>
              <button
                type="button"
                className={textLinkClass}
                onClick={() => {
                  setMode('view');
                }}
              >
                {t('compare.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-x-6">
            <button
              type="button"
              className={textLinkClass}
              aria-label={t('compare.renameLabel', { name: label })}
              onClick={() => {
                setMode('rename');
              }}
            >
              {t('compare.rename')}
            </button>
            <button
              type="button"
              className={dangerLinkClass}
              aria-label={t('compare.removeLabel', { name: label })}
              onClick={() => {
                setMode('remove');
              }}
            >
              {t('compare.remove')}
            </button>
          </div>
        ))}
    </div>
  );
}

function AddCriterion({
  count,
  change,
  words,
}: {
  readonly count: number;
  readonly change: Change;
  readonly words: CompareWords;
}) {
  const { t } = words;
  const titleId = useId();
  // Remounting the form empties it after each criterion is added.
  const [round, setRound] = useState(0);
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2 border-t border-line pt-5">
      <h4 id={titleId} className="font-medium">
        {t('compare.addTitle')}
      </h4>
      {count >= ownCriteriaLimit ? (
        <p className="text-small text-muted">
          {t('compare.ownLimit', { max: String(ownCriteriaLimit) })}
        </p>
      ) : (
        <NameForm
          key={round}
          label={t('compare.addLabel')}
          hint={t('compare.addHint')}
          initial=""
          submitLabel={t('compare.add')}
          onSubmit={(name) => {
            change({ kind: 'add', name });
            setRound((current) => current + 1);
          }}
          words={words}
        />
      )}
    </section>
  );
}

function NameForm({
  label,
  hint,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  words,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly initial: string;
  readonly submitLabel: string;
  readonly onSubmit: (name: string) => void;
  readonly onCancel?: () => void;
  readonly words: CompareWords;
}) {
  const [name, setName] = useState(initial);
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    // The API takes a name in NFC with no spaces around it.
    const cleaned = name.trim().normalize('NFC');
    if (cleaned !== '') onSubmit(cleaned);
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <TextField
        label={label}
        {...(hint === undefined ? {} : { hint })}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        required
        maxLength={ownCriterionNameLimit}
        pattern={notBlank}
        autoComplete="off"
        autoFocus={onCancel !== undefined}
      />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Button type="submit" variant="secondary">
          {submitLabel}
        </Button>
        {onCancel !== undefined && (
          <button type="button" className={textLinkClass} onClick={onCancel}>
            {words.t('compare.cancel')}
          </button>
        )}
      </div>
    </form>
  );
}
