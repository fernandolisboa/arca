import { StatusChip, cardClass } from '@arca/ui';
import type { ReactNode } from 'react';
import { FlagLead } from '../country-flag.js';
import type { KnowledgeWords } from '../knowledge/words.js';
import { type RouteRow, type Selection, resultsAnchor } from './group.js';
import { totalShort } from './route-detail.js';
import { statusTones } from './status-tone.js';

interface RowsProps {
  readonly rows: readonly RouteRow[];
  readonly principals: readonly string[];
  readonly selection: Selection | undefined;
  /** `null` closes the open card on a phone. */
  readonly onSelect: (selection: Selection | null) => void;
  readonly name: (id: string) => string;
  readonly words: KnowledgeWords;
}

/** The ID of a country's first row, which a link from another screen scrolls to. */
function anchors(rows: readonly RouteRow[]): Map<string, string> {
  const first = new Map<string, string>();
  for (const { route, routeId } of rows) {
    if (!first.has(route.country)) first.set(route.country, routeId);
  }
  return new Map([...first].map(([country, routeId]) => [routeId, resultsAnchor(country)]));
}

/**
 * The results on a wide screen: a route per row, a member as principal per column, each cell its
 * status and total cost. A cell opens that route for that member in the panel beside it.
 */
export function RouteTable({ rows, principals, selection, onSelect, name, words }: RowsProps) {
  const { t } = words;
  const anchorOf = anchors(rows);
  return (
    <div className={`${cardClass} overflow-x-auto`}>
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{t('results.tableCaption')}</caption>
        <thead>
          <tr className="border-b border-line align-bottom">
            <th scope="col" className="min-w-56 p-3 font-medium">
              {t('results.routeColumn')}
            </th>
            {principals.map((principalId) => (
              <th key={principalId} scope="col" className="min-w-36 p-3 font-medium break-words">
                {name(principalId)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const chosen = selection?.routeId === row.routeId;
            return (
              <tr
                key={row.routeId}
                id={anchorOf.get(row.routeId)}
                className={`scroll-mt-24 border-b border-line last:border-b-0 ${chosen ? 'bg-soft' : ''}`}
              >
                <th scope="row" className="p-3 text-left font-normal">
                  <span className="flex flex-col gap-0.5">
                    <span className="text-small text-muted">
                      <FlagLead code={row.route.country} />
                      {words.country(row.route.country)}
                    </span>
                    <span className="font-medium break-words">{row.route.title}</span>
                  </span>
                </th>
                {principals.map((principalId) => {
                  const result = row.results.find((each) => each.principalId === principalId);
                  if (result === undefined) return <td key={principalId} className="p-3" />;
                  const pressed = chosen && selection.principalId === principalId;
                  const total = totalShort(result, words);
                  return (
                    <td key={principalId} className="p-2 align-top">
                      <button
                        type="button"
                        aria-pressed={pressed}
                        onClick={() => {
                          onSelect({ routeId: row.routeId, principalId });
                        }}
                        className={`flex min-h-touch w-full flex-col items-start gap-1 rounded-control p-2 text-left hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${pressed ? 'ring-2 ring-primary' : ''}`}
                      >
                        <span className="sr-only">
                          {t('results.openCell', {
                            route: row.route.title,
                            name: name(principalId),
                          })}
                        </span>
                        <StatusChip
                          tone={statusTones[result.status]}
                          label={t('results.status', { status: result.status })}
                        />
                        {total !== null && (
                          <span className="text-small text-muted tabular-nums">{total}</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The results on a phone: a card per route with each member's status; the chosen card opens its
 * detail right under it, so the list never loses its place.
 */
export function RouteCards({
  rows,
  selection,
  onSelect,
  name,
  words,
  detail,
}: Omit<RowsProps, 'principals'> & { readonly detail: ReactNode }) {
  const { t } = words;
  const anchorOf = anchors(rows);
  return (
    <ul aria-label={t('results.tableCaption')} className="flex flex-col gap-3">
      {rows.map((row) => {
        const chosen = selection?.routeId === row.routeId;
        return (
          <li
            key={row.routeId}
            id={anchorOf.get(row.routeId)}
            className={`${cardClass} flex scroll-mt-24 flex-col gap-3 p-4`}
          >
            <button
              type="button"
              aria-expanded={chosen}
              onClick={() => {
                const first = row.results[0];
                onSelect(
                  chosen || first === undefined
                    ? null
                    : { routeId: row.routeId, principalId: first.principalId },
                );
              }}
              className="flex min-h-touch flex-col items-start gap-2 rounded-control text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="text-small text-muted">
                <FlagLead code={row.route.country} />
                {words.country(row.route.country)}
              </span>
              <span className="font-medium break-words">{row.route.title}</span>
              <span className="flex flex-col gap-1">
                {row.results.map((result) => (
                  <span key={result.principalId} className="flex flex-wrap items-center gap-2">
                    <span className="text-small">{name(result.principalId)}</span>
                    <StatusChip
                      tone={statusTones[result.status]}
                      label={t('results.status', { status: result.status })}
                    />
                  </span>
                ))}
              </span>
              {!chosen && <span className="text-small text-primary">{t('results.details')}</span>}
            </button>
            {chosen && <div className="border-t border-line pt-3">{detail}</div>}
          </li>
        );
      })}
    </ul>
  );
}
