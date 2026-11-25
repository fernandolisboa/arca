import { type RouteResult, staleAfterDays } from '@arca/api-contract/client';
import { SourceLine, StatusChip, Tabs, tabPanelProps } from '@arca/ui';
import { type ReactNode, useId, useState } from 'react';
import { FlagLead } from '../country-flag.js';
import type { KnowledgeWords } from '../knowledge/words.js';
import { type AmountForm, rangeForm, shownTotals } from './amount.js';
import type { RouteRow } from './group.js';
import { ReportRule } from './report-rule.js';
import { statusTones } from './status-tone.js';
import { RouteUpdateRequest } from './update-request.js';

type Source = RouteResult['requirements'][number]['sources'][number];
type Rule =
  | RouteResult['requirements'][number]
  | RouteResult['assessments'][number]
  | RouteResult['costs'][number]
  | RouteResult['durations'][number];

/** The words a range of amounts reads as, in the screen's language. */
export function amountText(form: AmountForm, words: KnowledgeWords): string {
  const { t, money } = words;
  switch (form.kind) {
    case 'exact':
      return money(form.amount.amount, form.amount.currency);
    case 'range':
      return t('results.amountRange', {
        min: money(form.min.amount, form.min.currency),
        max: money(form.max.amount, form.max.currency),
      });
    case 'from':
      return t('results.amountFrom', { min: money(form.min.amount, form.min.currency) });
    case 'upTo':
      return t('results.amountUpTo', { max: money(form.max.amount, form.max.currency) });
    case 'unknown':
      return t('results.amountUnknown');
  }
}

/** A route's total for one principal, in one short line, for the table's cells. */
export function totalShort(result: RouteResult, words: KnowledgeWords): string | null {
  const { certain, extra } = shownTotals(result.totals);
  if (certain.length === 0 && extra.length === 0) return null;
  const amounts = certain.map((form) => amountText(form, words)).join(' + ');
  return words.t('results.totalShort', {
    amount: amounts === '' ? words.t('results.totalMaybeOnly') : amounts,
    more: certain.length > 0 && extra.length > 0 ? 'yes' : 'no',
  });
}

/**
 * One route in full (spec 0007, R6): who goes with each member as principal, what each rule says
 * of the case, the total cost and every source. The titles are in the screen's language where
 * they have a translation (ADR-0036), and the version's English is one switch away.
 */
export function RouteDetail({
  row,
  principalId,
  onPrincipal,
  inline = false,
  name,
  words,
}: {
  readonly row: RouteRow;
  readonly principalId: string;
  readonly onPrincipal: (principalId: string) => void;
  /** Under its own card, which already names the route and country. */
  readonly inline?: boolean;
  readonly name: (id: string) => string;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const tabsId = useId();
  const [showOriginal, setShowOriginal] = useState(false);
  const result = row.results.find((each) => each.principalId === principalId) ?? row.results[0];
  if (result === undefined) return null;
  const translated =
    row.route.original !== null ||
    [...result.requirements, ...result.assessments, ...result.costs, ...result.durations].some(
      (item) => item.original !== null,
    );
  const versionNumber = row.results.find((each) => each.version !== null)?.version?.number;
  return (
    <article aria-label={row.route.title} className="flex flex-col gap-4">
      <header className={`flex flex-col gap-1 ${inline ? 'sr-only' : ''}`}>
        <p className="text-small text-muted">
          <FlagLead code={row.route.country} />
          {words.country(row.route.country)}
        </p>
        <h3 className="font-display text-lead break-words">{row.route.title}</h3>
        {showOriginal && row.route.original !== null && (
          <p className="text-small text-muted">
            {t('results.original', { text: row.route.original })}
          </p>
        )}
      </header>
      {translated && (
        <div className="flex flex-col gap-1 rounded-card bg-soft p-3 text-small">
          <p>{t('results.translatedNote')}</p>
          <label className="flex min-h-touch cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={showOriginal}
              onChange={(event) => {
                setShowOriginal(event.target.checked);
              }}
              className="size-4 accent-(--color-primary)"
            />
            {t('results.showOriginal')}
          </label>
        </div>
      )}
      {row.results.length > 1 && (
        <Tabs
          label={t('results.principalTabs')}
          tabs={row.results.map((each) => ({
            value: each.principalId,
            label: name(each.principalId),
          }))}
          value={result.principalId}
          onChange={onPrincipal}
          idBase={tabsId}
        />
      )}
      <div
        {...(row.results.length > 1 ? tabPanelProps(tabsId, result.principalId) : {})}
        className="flex flex-col gap-4 outline-none"
      >
        <PrincipalResult result={result} name={name} words={words} showOriginal={showOriginal} />
      </div>
      {versionNumber !== undefined && (
        <RouteUpdateRequest routeId={row.routeId} versionNumber={versionNumber} words={words} />
      )}
    </article>
  );
}

function PrincipalResult({
  result,
  name,
  words,
  showOriginal,
}: {
  readonly result: RouteResult;
  readonly name: (id: string) => string;
  readonly words: KnowledgeWords;
  readonly showOriginal: boolean;
}) {
  const { t } = words;
  const people = (ids: readonly string[]) => words.list(ids.map(name));
  const evaluated = result.status !== 'pending_activation' && result.status !== 'unavailable';
  const { certain, extra } = shownTotals(result.totals);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p>{t('results.principal', { name: name(result.principalId) })}</p>
        <StatusChip
          tone={statusTones[result.status]}
          label={t('results.status', { status: result.status })}
        />
      </div>
      {result.stale && (
        <p className="text-small text-warn-ink">{t('results.stale', { days: staleAfterDays })}</p>
      )}
      {result.closureSources.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-small">{t('results.closed')}</p>
          <Sources sources={result.closureSources} words={words} />
        </div>
      )}
      {result.newerProposedVersion !== null && (
        <p className="text-small text-muted">
          {t('results.newerVersion', { date: words.date(result.newerProposedVersion.from) })}
        </p>
      )}
      {evaluated && (
        <>
          <section aria-label={t('results.familyTitle')} className="flex flex-col gap-1 text-small">
            {result.dependents.length === 0 && result.possibleDependents.length === 0 && (
              <p>{t('results.nobodyWith')}</p>
            )}
            {result.dependents.length > 0 && (
              <p>{t('results.goWith', { names: people(result.dependents) })}</p>
            )}
            {result.possibleDependents.length > 0 && (
              <p>{t('results.mayGoWith', { names: people(result.possibleDependents) })}</p>
            )}
            {result.unitOpen && <p className="text-muted">{t('results.unitOpen')}</p>}
          </section>
          <section
            aria-label={t('results.totalTitle')}
            className="flex flex-col gap-1 rounded-card border border-line p-3"
          >
            <h4 className="font-medium">{t('results.totalTitle')}</h4>
            {certain.length === 0 && extra.length === 0 ? (
              <p className="text-small text-muted">{t('results.noCosts')}</p>
            ) : (
              <>
                {certain.length > 0 && (
                  <p className="font-display text-lead tabular-nums">
                    {certain.map((form) => amountText(form, words)).join(' + ')}
                  </p>
                )}
                {extra.length > 0 && (
                  <p className="text-small text-muted">
                    {extra.every(({ kind }) => kind === 'unknown')
                      ? t('results.totalExtraUnknown')
                      : t('results.totalExtra', {
                          amount: extra.map((form) => amountText(form, words)).join(' + '),
                        })}
                  </p>
                )}
                <p className="text-small text-muted">{t('results.totalHow')}</p>
              </>
            )}
          </section>
          {result.missingRates.length > 0 && (
            <p className="text-small text-muted">
              {t('results.missingRates', {
                n: result.missingRates.length,
                pairs: words.list(result.missingRates.map((pair) => t('results.ratePair', pair))),
              })}
            </p>
          )}
          {result.missingDates.length > 0 && (
            <p className="text-small text-muted">
              {t('results.missingDates', {
                dates: words.list(result.missingDates.map(words.referenceDate)),
              })}
            </p>
          )}
          <Rules
            title={t('results.requirementsTitle')}
            items={result.requirements}
            name={name}
            words={words}
            showOriginal={showOriginal}
            after={(requirement, lineId) =>
              result.version !== null && (
                <ReportRule
                  describedBy={lineId}
                  rule={{
                    routeId: result.routeId,
                    versionNumber: result.version.number,
                    requirementId: requirement.id,
                  }}
                />
              )
            }
          >
            {(requirement) =>
              t('results.requirement', {
                result:
                  requirement.result === true
                    ? 'yes'
                    : requirement.result === false
                      ? 'no'
                      : 'unknown',
              })
            }
          </Rules>
          {result.assessments.length > 0 && (
            <Rules
              title={t('results.assessmentsTitle')}
              items={result.assessments}
              name={name}
              words={words}
              showOriginal={showOriginal}
            >
              {() => t('results.assessmentNote')}
            </Rules>
          )}
          <Rules
            title={t('results.costsTitle')}
            items={result.costs.filter((cost) => cost.applies !== false)}
            name={name}
            words={words}
            showOriginal={showOriginal}
          >
            {(cost) => cost.applies === 'unknown' && t('results.costMaybe')}
          </Rules>
          {result.durations.length > 0 && (
            <Rules
              title={t('results.durationsTitle')}
              lead={t('results.durationsLead')}
              items={result.durations}
              name={name}
              words={words}
              showOriginal={showOriginal}
            >
              {() => null}
            </Rules>
          )}
        </>
      )}
    </>
  );
}

/** A line for each rule, with what it says of the case under it and every source (rule 1). */
function Rules<Item extends Rule>({
  title,
  lead,
  items,
  name,
  words,
  showOriginal,
  children,
  after,
}: {
  readonly title: string;
  readonly lead?: string;
  readonly items: readonly Item[];
  readonly name: (id: string) => string;
  readonly words: KnowledgeWords;
  readonly showOriginal: boolean;
  readonly children: (item: Item) => ReactNode;
  /** Shown under the item's sources, such as the way to report it, given the item line's ID. */
  readonly after?: (item: Item, lineId: string) => ReactNode;
}) {
  const baseId = useId();
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h4 className="font-medium">{title}</h4>
      {lead !== undefined && <p className="text-small text-muted">{lead}</p>}
      <ul className="flex flex-col gap-3">
        {items.map((item, index) => {
          const lineId = `${baseId}-${String(index)}`;
          const note = children(item);
          return (
            <li
              key={'costId' in item ? `${item.costId}:${item.personId ?? ''}` : item.id}
              className="flex flex-col gap-1 border-t border-line pt-3 first:border-t-0 first:pt-0"
            >
              <p id={lineId}>{ruleLine(item, words, name)}</p>
              {showOriginal && item.original !== null && (
                <p className="text-small text-muted">
                  {words.t('results.original', { text: item.original })}
                </p>
              )}
              {note !== null && note !== false && <p className="text-small text-muted">{note}</p>}
              <Sources sources={item.sources} words={words} />
              {after?.(item, lineId)}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ruleLine(item: Rule, words: KnowledgeWords, name: (id: string) => string): string {
  if ('costId' in item) {
    const amount = amountText(rangeForm(item.min, item.max), words);
    return item.personId === null
      ? words.t('results.cost', { title: item.title, amount })
      : words.t('results.costFor', { title: item.title, name: name(item.personId), amount });
  }
  if ('min' in item) {
    return words.t('results.duration', {
      title: item.title,
      min: words.duration(item.min),
      max: words.duration(item.max),
    });
  }
  return item.title;
}

function Sources({
  sources,
  words,
}: {
  readonly sources: readonly Source[];
  readonly words: KnowledgeWords;
}) {
  // The placeholders go back in, so the source line puts the link and the date in their place.
  const message = words.t('results.source', { host: '{host}', date: '{date}' });
  return (
    <>
      {sources.map((source) => (
        <SourceLine
          key={source.id}
          href={source.url}
          verifiedOn={source.verifiedAt}
          locale={words.language}
          message={message}
        />
      ))}
    </>
  );
}
