import {
  ApiError,
  type ChecklistMarkView,
  type DocumentGuideView,
  type DocumentItemView,
  type RouteDocuments,
  markStates,
} from '@arca/api-contract/client';
import {
  Button,
  ProgressBar,
  StatusChip,
  Tabs,
  buttonClass,
  cardClass,
  tabPanelProps,
} from '@arca/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { type ReactNode, createContext, use, useId, useMemo, useState } from 'react';
import { caseQuery, routeDocumentsQuery, sessionQuery } from '../api.js';
import { markFailure, setChecklistMark } from '../checklist-marks.js';
import { CountryFlag, FlagLead } from '../country-flag.js';
import { type OpenedDocument, documentsQuery } from '../documents.js';
import { SelectField } from '../forms/select-field.js';
import { textLinkClass } from '../forms/text-link.js';
import { type KnowledgeWords, useKnowledgeWords } from '../knowledge/words.js';
import { Page } from '../page.js';
import { passkeys } from '../platform.js';
import { Sources } from '../results/route-detail.js';
import { useMediaQuery } from '../use-media-query.js';
import { type UnlockedVault, useUnlockedVault } from '../vault-session.js';

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
      <Marking
        routeId={route}
        country={checklist.data.route?.country}
        accountId={session.data.accountId}
      >
        <Checklist checklist={checklist.data} name={name} words={words} />
      </Marking>
      {back}
    </Page>
  );
}

/** What marking an item needs: the route, and the viewer's own vault documents while it is open. */
interface MarkingContext {
  readonly routeId: string;
  /** The route's country, which linking files a document under. */
  readonly country: string | undefined;
  /** Undefined while the vault is closed on this device, so no document can be named or linked. */
  readonly documents: readonly OpenedDocument[] | undefined;
}

const MarkingContext = createContext<MarkingContext>({
  routeId: '',
  country: undefined,
  documents: undefined,
});

/** Opens the viewer's documents only while the vault is open here; their names stay in memory. */
function Marking({
  routeId,
  country,
  accountId,
  children,
}: {
  readonly routeId: string;
  readonly country: string | undefined;
  readonly accountId: string;
  readonly children: ReactNode;
}) {
  const vault = useUnlockedVault(accountId);
  const closed = useMemo(() => ({ routeId, country, documents: undefined }), [routeId, country]);
  if (vault === undefined) {
    return <MarkingContext value={closed}>{children}</MarkingContext>;
  }
  return (
    <OpenVaultMarking routeId={routeId} country={country} vault={vault}>
      {children}
    </OpenVaultMarking>
  );
}

function OpenVaultMarking({
  routeId,
  country,
  vault,
  children,
}: {
  readonly routeId: string;
  readonly country: string | undefined;
  readonly vault: UnlockedVault;
  readonly children: ReactNode;
}) {
  const documents = useQuery(documentsQuery(vault));
  const value = useMemo(
    () => ({
      routeId,
      country,
      documents: (documents.data?.opened ?? []).filter(
        ({ document, label }) => document.ownerId === vault.accountId && label !== undefined,
      ),
    }),
    [routeId, country, documents.data, vault.accountId],
  );
  return <MarkingContext value={value}>{children}</MarkingContext>;
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
      ? [...documents.people.flatMap((each) => each.items), ...documents.unit.items]
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
      {documents?.kind === 'listed' && documents.progress !== null && items.length > 0 && (
        <div className="max-w-md">
          <ProgressBar
            label={t('checklist.routeProgress')}
            value={documents.progress.had}
            max={documents.progress.total}
            valueText={t('checklist.progressValue', documents.progress)}
          />
        </div>
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
                ...each,
                id: each.personId,
                holder: each.personId,
                title: name(each.personId),
              })),
              ...(documents.unit.items.length === 0
                ? []
                : [
                    {
                      ...documents.unit,
                      id: unitRole,
                      holder: checklist.principalId,
                      title: t('checklist.unitTitle'),
                      role: unitRole,
                    },
                  ]),
            ]}
            name={name}
            words={words}
            showOriginal={showOriginal}
          />
        ))}
      {documents?.kind === 'listed' && documents.noLongerAsked.length > 0 && (
        <NoLongerAsked marks={documents.noLongerAsked} name={name} words={words} />
      )}
    </div>
  );
}

/** Marks on items the rule no longer asks for, kept so the family notices the change. */
function NoLongerAsked({
  marks,
  name,
  words,
}: {
  readonly marks: Extract<
    NonNullable<RouteDocuments['documents']>,
    { kind: 'listed' }
  >['noLongerAsked'];
  readonly name: (id: string) => string;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex max-w-3xl flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h3 id={headingId} className="font-display text-lead">
          {t('checklist.noLongerAsked.title')}
        </h3>
        <p className="text-small text-muted">{t('checklist.noLongerAsked.lead')}</p>
      </header>
      <ul className="grid gap-3 md:grid-cols-2">
        {marks.map((each) => (
          <li
            key={`${each.personId}:${each.documentId}`}
            className={`${cardClass} flex flex-col gap-2 p-4`}
          >
            <p className="font-medium break-words">
              {each.title ?? t('checklist.noLongerAsked.untitled')}
            </p>
            <p className="text-small text-muted">
              {name(each.personId)}
              {' · '}
              {t('checklist.mark.state', { state: each.mark.state })}
              {each.mark.linked && <> · {t('checklist.mark.linkedHere')}</>}
            </p>
            {each.editable && (
              <ClearMark personId={each.personId} documentId={each.documentId} words={words} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface List {
  readonly id: string;
  /** Whose marks the list holds: the person, or the principal for the unit. */
  readonly holder: string;
  readonly title: string;
  readonly role: 'principal' | 'dependent' | 'possible_dependent' | 'unit';
  readonly editable: boolean;
  readonly marksShown: boolean;
  readonly progress: { readonly had: number; readonly total: number } | null;
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
        {list.progress !== null && list.items.length > 0 && (
          <ProgressBar
            label={t('checklist.listProgress')}
            value={list.progress.had}
            max={list.progress.total}
            valueText={t('checklist.progressValue', list.progress)}
          />
        )}
        {!list.marksShown && list.items.length > 0 && (
          <p className="text-small text-muted">
            {t('checklist.mark.hidden', { name: name(list.holder) })}
          </p>
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
              list={list}
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
  list,
  name,
  words,
  showOriginal,
}: {
  readonly item: DocumentItemView;
  readonly list: List;
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
        <div className="flex flex-wrap gap-1">
          {item.applies === 'unknown' && <StatusChip tone="warn" label={t('checklist.mayApply')} />}
          {!list.editable && item.mark !== null && (
            <StatusChip
              tone={item.mark.state === 'had' ? 'ok' : 'unknown'}
              label={t('checklist.mark.state', { state: item.mark.state })}
            />
          )}
        </div>
      </div>
      {list.editable && (
        <MarkControls
          personId={list.holder}
          documentId={item.documentId}
          title={item.title}
          mark={item.mark}
          words={words}
        />
      )}
      {!list.editable && item.mark?.linked === true && (
        <p className="text-small text-muted">{t('checklist.mark.linkedHere')}</p>
      )}
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

/** Saves one mark, then reads the checklist again and, after a link, the vault's documents. */
function useSaveMark(personId: string, documentId: string) {
  const { routeId } = use(MarkingContext);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mark: { state: 'had' | 'missing'; vaultDocumentId: string | null } | null) =>
      setChecklistMark(passkeys, { routeId, personId, documentId, mark }),
    onSuccess: async (_saved, mark) => {
      await queryClient.invalidateQueries({ queryKey: ['case', 'documents', routeId] });
      if (mark?.vaultDocumentId != null) {
        await queryClient.invalidateQueries({ queryKey: ['documents'] });
      }
    },
  });
}

/** Had or missing for the keeper, and the vault document linked to it. */
function MarkControls({
  personId,
  documentId,
  title,
  mark,
  words,
}: {
  readonly personId: string;
  readonly documentId: string;
  readonly title: string;
  readonly mark: ChecklistMarkView | null;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const save = useSaveMark(personId, documentId);
  const groupId = useId();
  const pressedClass = `${buttonClass('secondary')} aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-on-primary`;
  return (
    <div className="flex flex-col gap-2 rounded-control bg-soft p-3">
      <div role="group" aria-labelledby={groupId} className="flex flex-wrap items-center gap-2">
        <span id={groupId} className="sr-only">
          {t('checklist.mark.group', { title })}
        </span>
        {markStates.map((state) => (
          <button
            key={state}
            type="button"
            aria-pressed={mark?.state === state}
            disabled={save.isPending}
            className={pressedClass}
            onClick={() => {
              // Pressing the chosen state again takes the mark off.
              save.mutate(
                mark?.state === state
                  ? null
                  : {
                      state,
                      vaultDocumentId: state === 'had' ? (mark?.vaultDocumentId ?? null) : null,
                    },
              );
            }}
          >
            {t(`checklist.mark.${state}`)}
          </button>
        ))}
      </div>
      <VaultLink mark={mark} save={save} words={words} />
      <p role="status" className="text-small text-ink">
        {save.isError ? t('checklist.mark.failure', { reason: markFailure(save.error) }) : ''}
      </p>
    </div>
  );
}

type SaveMark = ReturnType<typeof useSaveMark>;

/** The linked vault document, or a picker of the keeper's own while the vault is open here. */
function VaultLink({
  mark,
  save,
  words,
}: {
  readonly mark: ChecklistMarkView | null;
  readonly save: SaveMark;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const { country, documents } = use(MarkingContext);
  const [chosen, setChosen] = useState('');
  if (mark?.linked === true) {
    const linked = documents?.find(({ document }) => document.id === mark.vaultDocumentId);
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
        <span className="break-words">
          {linked?.label === undefined
            ? t('checklist.mark.linkedUnnamed')
            : t('checklist.mark.linked', { name: linked.label.name })}
        </span>
        <button
          type="button"
          className={textLinkClass}
          disabled={save.isPending}
          onClick={() => {
            save.mutate({ state: 'had', vaultDocumentId: null });
          }}
        >
          {t('checklist.mark.unlink')}
        </button>
      </div>
    );
  }
  if (documents === undefined) {
    return (
      <p className="text-small">
        <Link to="/vault" className={textLinkClass}>
          {t('checklist.mark.openVault')}
        </Link>
      </p>
    );
  }
  if (documents.length === 0) {
    return (
      <p className="text-small text-muted">
        {t('checklist.mark.vaultEmpty')}{' '}
        <Link to="/vault" className={textLinkClass}>
          {t('checklist.mark.toVault')}
        </Link>
      </p>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen !== '') save.mutate({ state: 'had', vaultDocumentId: chosen });
      }}
    >
      <div className="min-w-0 flex-1">
        <SelectField
          label={t('checklist.mark.linkLabel')}
          {...(country === undefined
            ? {}
            : { hint: t('checklist.mark.linkHint', { country: words.country(country) }) })}
          value={chosen}
          onChange={setChosen}
          placeholder={t('checklist.mark.linkPlaceholder')}
          options={documents.map(({ document, label }) => ({
            value: document.id,
            label: label?.name ?? '',
          }))}
        />
      </div>
      <Button type="submit" disabled={chosen === '' || save.isPending}>
        {t('checklist.mark.link')}
      </Button>
    </form>
  );
}

/** Takes off a mark the rule no longer asks for; a linked document stays in the vault. */
function ClearMark({
  personId,
  documentId,
  words,
}: {
  readonly personId: string;
  readonly documentId: string;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const save = useSaveMark(personId, documentId);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className={`${textLinkClass} self-start`}
        disabled={save.isPending}
        onClick={() => {
          save.mutate(null);
        }}
      >
        {t('checklist.noLongerAsked.clear')}
      </button>
      <p role="status" className="text-small text-ink">
        {save.isError ? t('checklist.mark.failure', { reason: markFailure(save.error) }) : ''}
      </p>
    </div>
  );
}
