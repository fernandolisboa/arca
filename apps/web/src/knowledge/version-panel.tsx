import { routes, decideVersionAction, type VersionView } from '@arca/api-contract/client';
import type { Messages } from '@arca/i18n';
import { Button } from '@arca/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { passkeys } from '../platform.js';
import { commonFailure, reach, type CommonFailure } from '../requests.js';
import { stepUpFor } from '../step-up.js';
import { ExpressionTree } from './expression-tree.js';
import { type KnowledgeWords, useKnowledgeWords } from './words.js';

type DecisionKind = 'activate' | 'reject';
type SectionKey = keyof Messages['knowledge']['section'];
type Failure = CommonFailure | 'rejected';

/** A decision after its own `knowledge_decision` step-up, bound to the version's content hash. */
async function decide(kind: DecisionKind, view: VersionView): Promise<void> {
  const route = kind === 'activate' ? routes.activateVersion : routes.rejectVersion;
  const request = { routeId: view.routeId, number: view.number };
  const approved = await stepUpFor(
    passkeys,
    decideVersionAction(route.operationId, request, view.hash),
    'knowledge_decision',
  );
  await reach(approved.call(route, request));
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h4 className="font-medium">{title}</h4>
      {children}
    </section>
  );
}

function Items<T>({
  items,
  render,
  words,
}: {
  readonly items: readonly T[];
  readonly render: (item: T) => ReactNode;
  readonly words: KnowledgeWords;
}) {
  if (items.length === 0) return <p className="text-muted">{words.t('knowledge.empty')}</p>;
  return <ul className="flex flex-col gap-4">{items.map(render)}</ul>;
}

/** The facts and sources an item reads, under it. */
function Reads({
  facts,
  sources,
  words,
}: {
  readonly facts?: VersionView['requirements'][number]['facts'];
  readonly sources: readonly string[];
  readonly words: KnowledgeWords;
}) {
  return (
    <div className="text-small text-muted">
      {facts !== undefined && facts.length > 0 && (
        <p>{words.t('knowledge.facts', { facts: words.list(facts.map(words.fact)) })}</p>
      )}
      {sources.length > 0 && (
        <p>{words.t('knowledge.sourceIds', { sources: words.list(sources) })}</p>
      )}
    </div>
  );
}

function Changes({ view, words }: { readonly view: VersionView; readonly words: KnowledgeWords }) {
  const { replaces } = view;
  if (replaces === null) return <p className="text-muted">{words.t('knowledge.firstVersion')}</p>;
  const lines = Object.entries(replaces.changes).flatMap(([section, change]) => {
    const details = [
      ...(change.added.length > 0
        ? [words.t('knowledge.changeAdded', { items: words.list(change.added) })]
        : []),
      ...(change.removed.length > 0
        ? [words.t('knowledge.changeRemoved', { items: words.list(change.removed) })]
        : []),
      ...(change.changed.length > 0
        ? [words.t('knowledge.changeChanged', { items: words.list(change.changed) })]
        : []),
    ];
    return details.length === 0
      ? []
      : [
          words.t('knowledge.change', {
            section: words.t(`knowledge.section.${section as SectionKey}`),
            details: words.list(details),
          }),
        ];
  });
  if (lines.length === 0) {
    return <p>{words.t('knowledge.noChanges', { number: replaces.number })}</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <p>{words.t('knowledge.changesSince', { number: replaces.number })}</p>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/** The approver's decision: activate, reject, or neither once rejected. */
function Decision({ view, words }: { readonly view: VersionView; readonly words: KnowledgeWords }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<DecisionKind | null>(null);
  const [state, setState] = useState<
    'idle' | 'waiting' | { readonly done: DecisionKind } | { readonly failure: Failure }
  >('idle');
  const statusRef = useRef<HTMLParagraphElement>(null);
  if (view.state === 'rejected') return <p>{words.t('knowledge.rejectedNote')}</p>;

  const start = (kind: DecisionKind) => {
    setConfirming(null);
    setState('waiting');
    decide(kind, view)
      .then(async () => {
        setState({ done: kind });
        await queryClient.invalidateQueries({ queryKey: ['knowledge'] });
      })
      .catch((error: unknown) => {
        setState({
          failure: commonFailure(error, (apiError) =>
            apiError.code === 'already_rejected' ? 'rejected' : undefined,
          ),
        });
      })
      .finally(() => {
        statusRef.current?.focus();
      });
  };
  const { fallback, selected } = view.rejection;
  const message =
    state === 'waiting'
      ? words.t('knowledge.waiting')
      : typeof state === 'object'
        ? 'done' in state
          ? words.t('knowledge.decided', { kind: state.done })
          : words.t('knowledge.failure', { reason: state.failure })
        : '';
  return (
    <div className="flex flex-col items-start gap-3">
      {confirming === null ? (
        <div className="flex flex-wrap gap-3">
          {view.state === 'proposed' && (
            <Button
              disabled={state === 'waiting'}
              onClick={() => {
                setConfirming('activate');
              }}
            >
              {words.t('knowledge.activate')}
            </Button>
          )}
          <Button
            disabled={state === 'waiting'}
            onClick={() => {
              setConfirming('reject');
            }}
          >
            {words.t('knowledge.reject')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          {confirming === 'activate' ? (
            <p>{words.t('knowledge.activateLead', { date: words.date(view.effectiveFrom) })}</p>
          ) : (
            <>
              {selected && (
                <p className="text-danger-ink">
                  {words.t('knowledge.rejectFallback', {
                    fallback: fallback === null ? 'none' : fallback.state,
                    number: fallback?.number ?? 0,
                  })}
                </p>
              )}
              <p>{words.t('knowledge.rejectLead')}</p>
            </>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => {
                start(confirming);
              }}
            >
              {words.t('knowledge.confirm')}
            </Button>
            <Button
              onClick={() => {
                setConfirming(null);
              }}
            >
              {words.t('knowledge.cancel')}
            </Button>
          </div>
        </div>
      )}
      <p ref={statusRef} role="status" tabIndex={-1}>
        {message}
      </p>
    </div>
  );
}

/** One version as data (spec 0007, R7): what it requires, what changed, its sources and cases. */
export function VersionPanel({ view }: { readonly view: VersionView }) {
  const words = useKnowledgeWords();
  const { t } = words;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-title font-medium">
          {t('knowledge.versionTitle', { title: view.title, number: view.number })}
        </h3>
        <p className="text-muted">
          {t('knowledge.versionMeta', {
            country: words.country(view.country),
            date: words.date(view.effectiveFrom),
          })}
        </p>
        <p className="font-medium">{t('knowledge.state', { state: view.state })}</p>
        {view.status === 'closed' && <p>{t('knowledge.closed')}</p>}
        {view.corrects !== null && <p>{t('knowledge.corrects', { number: view.corrects })}</p>}
        <p className="text-small text-muted">
          {t('knowledge.currency', { currency: view.currency })}
        </p>
      </div>
      <Section title={t('knowledge.section.changes')}>
        <Changes view={view} words={words} />
      </Section>
      <Section title={t('knowledge.section.requirements')}>
        <Items
          words={words}
          items={view.requirements}
          render={(requirement) => (
            <li key={requirement.id} className="flex flex-col gap-2">
              <p className="font-medium">{requirement.title}</p>
              <ExpressionTree expression={requirement.expression} />
              <Reads facts={requirement.facts} sources={requirement.sources} words={words} />
            </li>
          )}
        />
      </Section>
      <Section title={t('knowledge.section.assessments')}>
        <Items
          words={words}
          items={view.assessments}
          render={(assessment) => (
            <li key={assessment.id} className="flex flex-col gap-1">
              <p className="font-medium">{assessment.title}</p>
              <Reads facts={assessment.evidence} sources={assessment.sources} words={words} />
            </li>
          )}
        />
      </Section>
      <Section title={t('knowledge.section.dependents')}>
        <Items
          words={words}
          items={view.dependents}
          render={(dependent) => (
            <li key={dependent.id} className="flex flex-col gap-2">
              <p className="font-medium">{dependent.title}</p>
              <p>
                {t('knowledge.path', {
                  path: dependent.path.map(words.step).join(' → '),
                })}
              </p>
              {dependent.at !== null && <p>{t('knowledge.at', { at: dependent.at })}</p>}
              <p>{t('knowledge.condition')}</p>
              <ExpressionTree expression={dependent.condition} />
              <Reads facts={dependent.facts} sources={dependent.sources} words={words} />
            </li>
          )}
        />
      </Section>
      <Section title={t('knowledge.section.costs')}>
        <Items
          words={words}
          items={view.costs}
          render={(cost) => (
            <li key={cost.id} className="flex flex-col gap-2">
              <p className="font-medium">{cost.title}</p>
              <p>{t('knowledge.appliesTo', { appliesTo: cost.appliesTo })}</p>
              <p className="text-small text-muted">
                {t('knowledge.costKind', { kind: cost.kind })}
              </p>
              <p>{t('knowledge.amount')}</p>
              <ExpressionTree expression={cost.amount} />
              {cost.condition !== null && (
                <>
                  <p>{t('knowledge.onlyWhen')}</p>
                  <ExpressionTree expression={cost.condition} />
                </>
              )}
              <Reads facts={cost.facts} sources={cost.sources} words={words} />
            </li>
          )}
        />
      </Section>
      <Section title={t('knowledge.section.durations')}>
        <Items
          words={words}
          items={view.durations}
          render={(stage) => (
            <li key={stage.id} className="flex flex-col gap-1">
              <p>
                {t('knowledge.durationRange', {
                  title: stage.title,
                  min: words.duration(stage.min),
                  max: words.duration(stage.max),
                })}
              </p>
              <Reads sources={stage.sources} words={words} />
            </li>
          )}
        />
      </Section>
      <Section title={t('knowledge.section.countrySets')}>
        <Items
          words={words}
          items={view.countrySets}
          render={(set) => (
            <li key={set.id}>
              {t('knowledge.countrySet', {
                title: set.title,
                number: set.number,
                members: words.list(set.members.map(words.country)),
              })}
            </li>
          )}
        />
      </Section>
      <Section title={t('knowledge.section.sources')}>
        <Items
          words={words}
          items={view.sources}
          render={(source) => (
            <li key={source.id} className="flex flex-col gap-1">
              <p className="font-medium">{source.title}</p>
              {/* Plain text, never a link: the approver reads the full address before opening it. */}
              <p className="break-all font-mono text-small">{source.url}</p>
              <p className="text-small text-muted">
                {[
                  source.id,
                  t('knowledge.sourceKind', { kind: source.kind }),
                  t('knowledge.verifiedAt', { date: words.date(source.verifiedAt) }),
                ].join(' · ')}
              </p>
              {source.newHost && (
                <p className="font-medium text-danger-ink">{t('knowledge.newHost')}</p>
              )}
            </li>
          )}
        />
      </Section>
      <Section title={t('knowledge.section.cases')}>
        <Items
          words={words}
          items={view.cases}
          render={(ruleCase) => (
            <li key={ruleCase.id} className="flex flex-col gap-1">
              <p>
                {t('knowledge.case', {
                  id: ruleCase.id,
                  status: t('knowledge.caseStatus', { status: ruleCase.expected.status }),
                })}
              </p>
              <p className="text-small text-muted">
                {t('knowledge.caseDetails', {
                  date: words.date(ruleCase.rulesAsOf),
                  dependents: ruleCase.expected.dependents.length,
                  possible: ruleCase.expected.possibleDependents.length,
                })}
              </p>
              {ruleCase.expected.missingFacts.length > 0 && (
                <p className="text-small text-muted">
                  {t('knowledge.caseMissing', {
                    facts: words.list(ruleCase.expected.missingFacts),
                  })}
                </p>
              )}
            </li>
          )}
        />
      </Section>
      <Section title={t('knowledge.check.title')}>
        <p>{t('knowledge.check.body')}</p>
      </Section>
      <div className="flex flex-col gap-1">
        <p className="text-small text-muted">{t('knowledge.hash')}</p>
        <p className="break-all font-mono text-small">{view.hash}</p>
      </div>
      <Decision view={view} words={words} />
    </div>
  );
}
