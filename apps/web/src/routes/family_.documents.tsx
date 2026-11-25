import {
  ApiError,
  type DocumentGuideView,
  type DocumentItemView,
  type RouteDocuments,
} from '@arca/api-contract/client';
import { Button, StatusChip, Tabs, cardClass, tabPanelProps } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { caseQuery, routeDocumentsQuery, sessionQuery } from '../api.js';
import { CountryFlag, FlagLead } from '../country-flag.js';
import { textLinkClass } from '../forms/text-link.js';
import { type KnowledgeWords, useKnowledgeWords } from '../knowledge/words.js';
import { Page } from '../page.js';
import { Sources } from '../results/route-detail.js';
import { useMediaQuery } from '../use-media-query.js';

export function documentsSearch(search: Record<string, unknown>): {
  route?: string;
  person?: string;
} {
  const { route, person } = search;
  return {
    ...(typeof route === 'string' ? { route } : {}),
    ...(typeof person === 'string' ? { person } : {}),
  };
}

export const Route = createFileRoute('/family_/documents')({
  validateSearch: documentsSearch,
  component: Documents,
});

function Documents() {
  const words = useKnowledgeWords();
  const { t } = words;
  const { route = '', person = '' } = Route.useSearch();
  const session = useQuery(sessionQuery);
  const confirmed = session.data?.confirmed === true;
  const familyCase = useQuery({ ...caseQuery, enabled: confirmed });
  const checklist = useQuery({
    ...routeDocumentsQuery(route, person),
    enabled: confirmed && route !== '' && person !== '',
  });
  const title = t('checklist.title');
  const back = (
    <Link to="/family/results" className={`${textLinkClass} self-start`}>
      {t('checklist.back')}
    </Link>
  );
  if (session.isError) {
    return (
      <Page narrow title={title}>
        <p>{t('checklist.signIn')}</p>
        <Link to="/sign-in" className={textLinkClass}>
          {t('session.signIn')}
        </Link>
      </Page>
    );
  }
  if (!session.isSuccess) return <Page title={title} />;
  if (!confirmed) {
    return (
      <Page narrow title={title}>
        <p>{t('session.unconfirmed')}</p>
      </Page>
    );
  }
  if (familyCase.data?.case === null) {
    return (
      <Page narrow title={title}>
        <p>{t('checklist.noCase')}</p>
        {back}
      </Page>
    );
  }
  const status = checklist.error instanceof ApiError ? checklist.error.status : undefined;
  if (route === '' || person === '' || status === 404 || status === 400) {
    return (
      <Page narrow title={title}>
        <p>{t('checklist.missing')}</p>
        {back}
      </Page>
    );
  }
  if (familyCase.isError || checklist.isError) {
    return (
      <Page narrow title={title}>
        <p role="alert">{t(status === 429 ? 'checklist.tooMany' : 'checklist.loadFailure')}</p>
        <Button
          onClick={() => {
            void familyCase.refetch();
            void checklist.refetch();
          }}
        >
          {t('checklist.retry')}
        </Button>
        {back}
      </Page>
    );
  }
  const view = familyCase.data?.case;
  if (view === undefined || checklist.data === undefined) {
    return (
      <Page title={title}>
        <p className="text-muted">{t('checklist.loading')}</p>
      </Page>
    );
  }
  const names = new Map(view.people.map((each) => [each.id, each.displayName]));
  const name = (id: string) => names.get(id) ?? t('results.someone');
  return (
    <Page title={title} lead={t('checklist.lead', { name: name(checklist.data.principalId) })}>
      <Checklist checklist={checklist.data} name={name} words={words} />
      {back}
    </Page>
  );
}

function Checklist({
  checklist,
  name,
  words,
}: {
  readonly checklist: RouteDocuments;
  readonly name: (id: string) => string;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const [showOriginal, setShowOriginal] = useState(false);
  const { route, documents } = checklist;
  const items =
    documents?.kind === 'listed'
      ? [...documents.people.flatMap((each) => each.items), ...documents.unit]
      : [];
  const translated =
    route?.original != null ||
    items.some(({ original, noteOriginal }) => original !== null || noteOriginal !== null);
  return (
    <div className="flex flex-col gap-5">
      {route !== null && (
        <header className="flex flex-col gap-1">
          <p className="text-small text-muted">
            <FlagLead code={route.country} />
            {words.country(route.country)}
          </p>
          <h3 className="font-display text-lead break-words">{route.title}</h3>
          {showOriginal && route.original !== null && (
            <p className="text-small text-muted">
              {t('results.original', { text: route.original })}
            </p>
          )}
        </header>
      )}
      {checklist.status === 'unavailable' && <p>{t('checklist.unavailable')}</p>}
      {checklist.status === 'pending_activation' && <p>{t('checklist.pending')}</p>}
      {checklist.newerProposedVersion !== null && (
        <p className="text-small text-warn-ink">
          {t('checklist.newerVersion', { date: words.date(checklist.newerProposedVersion.from) })}
        </p>
      )}
      {translated && (
        <div className="flex max-w-prose flex-col gap-1 rounded-card bg-soft p-3 text-small">
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
      {documents?.kind === 'not_covered' && (
        <p className="max-w-prose rounded-card border border-line p-4">
          {t('checklist.notCovered')}
        </p>
      )}
      {documents?.kind === 'listed' &&
        (items.length === 0 ? (
          <p className="max-w-prose rounded-card border border-line p-4">
            {t(documents.asksNone ? 'checklist.noneAsked' : 'checklist.noneApply')}
          </p>
        ) : (
          <Lists
            lists={[
              ...documents.people.map((each) => ({
                id: each.personId,
                title: name(each.personId),
                role: each.role,
                items: each.items,
              })),
              ...(documents.unit.length === 0
                ? []
                : [
                    {
                      id: unitRole,
                      title: t('checklist.unitTitle'),
                      role: unitRole,
                      items: documents.unit,
                    },
                  ]),
            ]}
            name={name}
            words={words}
            showOriginal={showOriginal}
          />
        ))}
    </div>
  );
}

interface List {
  readonly id: string;
  readonly title: string;
  readonly role: 'principal' | 'dependent' | 'possible_dependent' | 'unit';
  readonly items: readonly DocumentItemView[];
}

/** Wide enough for the lists side by side. */
const sideBySideQuery = '(min-width: 48rem)';
const unitRole = 'unit' as const;

/** Side by side from a tablet up, each person a column; a tab per person on a phone. */
function Lists({
  lists,
  name,
  words,
  showOriginal,
}: {
  readonly lists: readonly List[];
  readonly name: (id: string) => string;
  readonly words: KnowledgeWords;
  readonly showOriginal: boolean;
}) {
  const { t } = words;
  const wide = useMediaQuery(sideBySideQuery);
  const tabsId = useId();
  const [chosen, setChosen] = useState<string>();
  const column = (list: List) => (
    <PersonList list={list} name={name} words={words} showOriginal={showOriginal} />
  );
  if (wide) {
    return (
      <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
        {lists.map((list) => (
          <div key={list.id} className="min-w-0">
            {column(list)}
          </div>
        ))}
      </div>
    );
  }
  const selected = lists.find(({ id }) => id === chosen) ?? lists[0];
  if (selected === undefined) return null;
  return (
    <div className="flex flex-col gap-4">
      <Tabs
        label={t('checklist.peopleTabs')}
        tabs={lists.map(({ id, title }) => ({ value: id, label: title }))}
        value={selected.id}
        onChange={setChosen}
        idBase={tabsId}
      />
      <div {...tabPanelProps(tabsId, selected.id)} className="outline-none">
        {column(selected)}
      </div>
    </div>
  );
}

function PersonList({
  list,
  name,
  words,
  showOriginal,
}: {
  readonly list: List;
  readonly name: (id: string) => string;
  readonly words: KnowledgeWords;
  readonly showOriginal: boolean;
}) {
  const { t } = words;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h3 id={headingId} className="font-display text-lead break-words">
          {list.title}
        </h3>
        <p className="text-small text-muted">
          {list.role === 'unit'
            ? t('checklist.unitLead')
            : t('checklist.role', { role: list.role })}
          {' · '}
          {t('checklist.count', { n: list.items.length })}
        </p>
        {list.role === 'possible_dependent' && (
          <p className="text-small text-muted">{t('checklist.possibleNote')}</p>
        )}
      </header>
      {list.items.length === 0 ? (
        <p className="text-small text-muted">{t('checklist.nothingHere')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.items.map((item) => (
            <Item
              key={item.documentId}
              item={item}
              name={name}
              words={words}
              showOriginal={showOriginal}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Item({
  item,
  name,
  words,
  showOriginal,
}: {
  readonly item: DocumentItemView;
  readonly name: (id: string) => string;
  readonly words: KnowledgeWords;
  readonly showOriginal: boolean;
}) {
  const { t } = words;
  const titleId = useId();
  const apostille = item.apostille === null ? 'unknown' : item.apostille ? 'yes' : 'no';
  return (
    <li aria-labelledby={titleId} className={`${cardClass} flex flex-col gap-2 p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 id={titleId} className="font-medium break-words">
          {item.title}
        </h4>
        {item.applies === 'unknown' && <StatusChip tone="warn" label={t('checklist.mayApply')} />}
      </div>
      {showOriginal && item.original !== null && (
        <p className="text-small text-muted">{t('results.original', { text: item.original })}</p>
      )}
      {item.applies === 'unknown' && item.dependsOn.length === 0 && (
        <p className="text-small text-muted">{t('checklist.dependsOnSource')}</p>
      )}
      {item.dependsOn.length > 0 && (
        <div className="flex flex-col gap-1 text-small">
          <p className="text-muted">{t('checklist.dependsOn')}</p>
          <ul className="flex flex-col gap-1">
            {item.dependsOn.map((question) => {
              const asked = t(`questions.asked.${question.question}`, {
                name: name(question.personId),
              });
              return (
                <li key={`${question.personId}:${question.question}`}>
                  {question.kept ? (
                    <>
                      {asked}{' '}
                      <Link to="/family/questions" className={textLinkClass}>
                        {t('checklist.answer')}
                      </Link>
                    </>
                  ) : (
                    t('checklist.askKeeper', { name: name(question.personId), question: asked })
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <ul className="flex flex-col gap-0.5 text-small">
        <li>{t('checklist.apostille', { value: apostille })}</li>
        <li>{t('checklist.translation', { value: item.translation ?? 'unknown' })}</li>
        <li>
          {item.validity === null
            ? t('checklist.validityUnknown')
            : t('checklist.validity', { duration: words.duration(item.validity) })}
        </li>
      </ul>
      {item.note !== null && (
        <p className="text-small text-muted">
          {item.note}
          {showOriginal && item.noteOriginal !== null && (
            <> ({t('results.original', { text: item.noteOriginal })})</>
          )}
        </p>
      )}
      <Sources sources={item.sources} words={words} />
      <div className="flex flex-col gap-2 border-t border-line pt-2">
        {item.guides.length === 0 ? (
          <p className="text-small text-muted">{t('checklist.guideUnknown')}</p>
        ) : (
          item.guides.map((guide) => (
            <Guide key={guide.country} guide={guide} kind={item.kind} words={words} />
          ))
        )}
      </div>
    </li>
  );
}

/** Where to get the document in one issuing country, in the catalog's reviewed wording. */
function Guide({
  guide,
  kind,
  words,
}: {
  readonly guide: DocumentGuideView;
  readonly kind: string;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const wording = (field: string) => {
    const key = `documentGuide.${guide.country}.${kind}.${field}`;
    return words.labelled(key, '');
  };
  const office = wording('office');
  const request = wording('request');
  const apostille = wording('apostille');
  return (
    <div className="flex flex-col gap-1 text-small">
      <p className="font-medium">
        <CountryFlag code={guide.country} className="mr-[0.45em] align-[-0.06em]" />
        {t('checklist.guideTitle', { country: words.country(guide.country) })}
      </p>
      {office !== '' && <p>{office}</p>}
      {request !== '' && <p>{request}</p>}
      {apostille !== '' && <p>{apostille}</p>}
      {guide.cost !== null && (
        <p>
          {t('checklist.cost', {
            amount:
              guide.cost.min.amount === guide.cost.max.amount
                ? words.money(guide.cost.min.amount, guide.cost.min.currency)
                : t('results.amountRange', {
                    min: words.money(guide.cost.min.amount, guide.cost.min.currency),
                    max: words.money(guide.cost.max.amount, guide.cost.max.currency),
                  }),
          })}
        </p>
      )}
      {guide.leadTime !== null && (
        <p>
          {guide.leadTime.min === guide.leadTime.max
            ? t('checklist.leadTimeExact', {
                duration: words.duration(guide.leadTime.min),
                business: guide.leadTime.businessDays ? 'yes' : 'no',
              })
            : t('checklist.leadTime', {
                min: words.duration(guide.leadTime.min),
                max: words.duration(guide.leadTime.max),
                business: guide.leadTime.businessDays ? 'yes' : 'no',
              })}
        </p>
      )}
      {guide.onlineUrl !== null && (
        <a
          href={guide.onlineUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${textLinkClass} self-start`}
        >
          {t('checklist.online')}
        </a>
      )}
      <Sources sources={guide.sources} words={words} />
    </div>
  );
}
