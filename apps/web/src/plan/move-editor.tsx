import { type CaseEvaluations, maxPlanStages } from '@arca/api-contract/client';
import { Button, StatusChip } from '@arca/ui';
import { type SubmitEvent, useState } from 'react';
import { CheckRow } from '../forms/check-row.js';
import { SelectField } from '../forms/select-field.js';
import type { KnowledgeWords } from '../knowledge/words.js';
import type { RouteRow } from '../results/group.js';
import { statusTones } from '../results/status-tone.js';
import { type WrittenMove, routeTaken } from './moves.js';

/** A person the editor can name: who may apply, and who may be taken along. */
export interface PlanPerson {
  readonly id: string;
  readonly name: string;
  readonly inPlanning: boolean;
}

/**
 * Adds or changes one move: who applies, for which route, in which stage, and who goes along.
 * Beside each person, what the evaluation of the whole family says of them on that route, so the
 * choice is informed; the plan's own evaluation then counts only the people chosen.
 */
export function MoveEditor({
  moves,
  editing,
  initial,
  people,
  rows,
  evaluations,
  saving,
  failure,
  onSave,
  onCancel,
  words,
}: {
  readonly moves: readonly WrittenMove[];
  /** The move's place in the plan, or null for a new one. */
  readonly editing: number | null;
  readonly initial: WrittenMove;
  readonly people: readonly PlanPerson[];
  readonly rows: readonly RouteRow[];
  readonly evaluations: CaseEvaluations;
  readonly saving: boolean;
  readonly failure: string | undefined;
  readonly onSave: (move: WrittenMove) => void;
  readonly onCancel: () => void;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const [move, setMove] = useState(initial);
  const change = (patch: Partial<WrittenMove>) => {
    setMove((current) => ({ ...current, ...patch }));
  };
  const result = evaluations.results.find(
    ({ routeId, principalId }) => routeId === move.routeId && principalId === move.principalId,
  );
  const coverage = (personId: string) =>
    result === undefined
      ? undefined
      : result.dependents.includes(personId)
        ? 'covered'
        : result.possibleDependents.includes(personId)
          ? 'possible'
          : 'not_covered';
  const taken = routeTaken(moves, editing, move.routeId, move.principalId);
  const ready = move.routeId !== '' && move.principalId !== '' && !taken;
  const routeOptions = [...rows]
    .sort(
      (left, right) =>
        words.country(left.route.country).localeCompare(words.country(right.route.country)) ||
        left.route.title.localeCompare(right.route.title),
    )
    .map(({ routeId, route }) => ({
      value: routeId,
      label: t('plan.editor.routeOption', {
        country: words.country(route.country),
        route: route.title,
      }),
    }));
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (ready) onSave(move);
  };
  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4"
      aria-label={t('plan.editor.title', { editing: editing === null ? 'no' : 'yes' })}
    >
      <h3 className="font-display text-lead">
        {t('plan.editor.title', { editing: editing === null ? 'no' : 'yes' })}
      </h3>
      <SelectField
        label={t('plan.editor.principal')}
        hint={t('plan.editor.principalHint')}
        value={move.principalId}
        placeholder={t('plan.editor.pick')}
        required
        onChange={(principalId) => {
          change({
            principalId,
            dependentIds: move.dependentIds.filter((id) => id !== principalId),
          });
        }}
        options={people
          .filter(({ inPlanning }) => inPlanning)
          .map(({ id, name }) => ({ value: id, label: name }))}
      />
      <SelectField
        label={t('plan.editor.route')}
        value={move.routeId}
        placeholder={t('plan.editor.pick')}
        required
        onChange={(routeId) => {
          change({ routeId });
        }}
        options={routeOptions}
      />
      {result !== undefined && (
        <p className="flex flex-wrap items-center gap-2 text-small">
          {t('plan.editor.statusNow')}
          <StatusChip
            tone={statusTones[result.status]}
            label={t('results.status', { status: result.status })}
          />
        </p>
      )}
      {taken && (
        <p role="alert" className="text-small text-danger-ink">
          {t('plan.editor.taken')}
        </p>
      )}
      <SelectField
        label={t('plan.editor.stage')}
        hint={t('plan.editor.stageHint')}
        value={String(move.stage)}
        onChange={(stage) => {
          change({ stage: Number(stage) });
        }}
        options={Array.from({ length: maxPlanStages }, (_, at) => ({
          value: String(at + 1),
          label: t('plan.stage', { n: at + 1 }),
        }))}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">{t('plan.editor.together')}</legend>
        <p className="text-small text-muted">{t('plan.editor.togetherHint')}</p>
        {people
          .filter(({ id }) => id !== move.principalId)
          .map(({ id, name }) => {
            const shown = coverage(id);
            return (
              <div key={id} className="flex flex-col gap-1">
                <CheckRow
                  label={name}
                  checked={move.dependentIds.includes(id)}
                  onChange={(checked) => {
                    change({
                      dependentIds: checked
                        ? [...move.dependentIds, id]
                        : move.dependentIds.filter((other) => other !== id),
                    });
                  }}
                />
                {shown !== undefined && (
                  <p className="pl-3 text-small text-muted">
                    {t('plan.coverage', { coverage: shown })}
                  </p>
                )}
              </div>
            );
          })}
      </fieldset>
      {failure !== undefined && (
        <p role="alert" className="text-small text-danger-ink">
          {failure}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={!ready || saving}>
          {t(saving ? 'plan.editor.saving' : 'plan.editor.save')}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t('plan.editor.cancel')}
        </Button>
      </div>
    </form>
  );
}
