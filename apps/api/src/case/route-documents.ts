import type { ChecklistMarkView } from '@arca/api-contract/routes';
import {
  type DocumentGuideEntry,
  type DocumentResult,
  citizenshipsHeldOn,
  decisiveQuestions,
  droppedItems,
  guideEntriesFor,
  listProgress,
  routeDocuments,
  routeProgress,
  unitsAmount,
} from '@arca/domain';
import { translatedText, viewedSnapshot } from './case-snapshot.js';
import type { EvaluationSettings } from './evaluations.js';
import type { CaseRows } from './view.js';

export interface RouteDocumentsSettings extends Omit<EvaluationSettings, 'routeIds'> {
  /** Where to get each document kind, per issuing country (ADR-0039). */
  readonly guides: readonly DocumentGuideEntry[];
}

/** A mark on the route the viewer sees, as row-level security returned it, shown as it leaves. */
export interface SeenMark {
  readonly personId: string;
  readonly documentId: string;
  readonly mark: ChecklistMarkView;
}

/**
 * One route's document checklist for one member as principal (spec #519), from what the viewer
 * sees, as `caseEvaluations` reads it: a hidden fact is an unknown one, so an item that reads it
 * may apply. Only an active version's content leaves (rule 5). Each item is named field by field,
 * so the traces and missing facts, with their case-internal IDs, stay here: what an item depends on
 * leaves as the questions that settle it, as the results' questions do. Each list carries the
 * marks the viewer sees on it, keyed on the item's ID (the unit's on the principal), and the marks
 * on items the version no longer lists come apart. Null when the principal is not a member.
 */
export function caseRouteDocuments(
  rows: CaseRows,
  routeId: string,
  principalUuid: string,
  { catalog, states, today, engineCommit, texts, guides }: RouteDocumentsSettings,
  marks: readonly SeenMark[],
) {
  const { snapshot, personIds, uuid, kept, bornOn } = viewedSnapshot(rows, today);
  const principal = personIds.get(principalUuid);
  if (principal === undefined || !snapshot.members.includes(principal)) return null;
  const selected = routeDocuments(snapshot, catalog, routeId, principal, {
    rulesAsOf: today,
    factsAsOf: today,
    today,
    fx: { rates: [] },
    states,
    engineCommit,
  });
  const none = {
    routeId,
    principalId: principalUuid,
    route: null,
    newerProposedVersion: null,
    documents: null,
  };
  if (selected.kind === 'no_version') return { ...none, status: 'unavailable', version: null };
  if (selected.kind === 'pending') {
    return {
      ...none,
      status: 'pending_activation',
      version: { number: selected.pending.number },
    };
  }
  const { entry, checklist, newerProposedVersion } = selected;
  const translated = translatedText(texts, routeId);
  const title = translated(entry.version.title);
  const citizenships = new Map(
    snapshot.people.map((person) => [person.id, citizenshipsHeldOn(person, today)]),
  );
  const item = (document: DocumentResult, holder: string) => {
    const itemTitle = translated(document.title);
    const note = document.note === undefined ? undefined : translated(document.note);
    return {
      documentId: document.documentId,
      title: itemTitle.text,
      original: itemTitle.original,
      kind: document.kind,
      applies: document.applies,
      apostille: document.apostille ?? null,
      translation: document.translation ?? null,
      validity: document.validity ?? null,
      note: note?.text ?? null,
      noteOriginal: note?.original ?? null,
      sources: document.sources,
      dependsOn: decisiveQuestions([document], kept, bornOn).map((question) => ({
        personId: uuid(question.personId),
        question: question.question,
        kept: question.kept,
      })),
      guides: guideEntriesFor(guides, citizenships.get(holder) ?? [], document.kind).map(
        (guide) => ({
          country: guide.country,
          onlineUrl: guide.onlineUrl ?? null,
          cost:
            guide.cost === undefined
              ? null
              : {
                  min: {
                    amount: unitsAmount(guide.cost.min, guide.cost.currency),
                    currency: guide.cost.currency,
                  },
                  max: {
                    amount: unitsAmount(guide.cost.max, guide.cost.currency),
                    currency: guide.cost.currency,
                  },
                },
          leadTime:
            guide.leadTime === undefined
              ? null
              : {
                  min: guide.leadTime.min,
                  max: guide.leadTime.max,
                  businessDays: guide.leadTime.businessDays === true,
                },
          sources: guide.sources,
        }),
      ),
    };
  };
  const markOf = new Map(
    marks.map(({ personId, documentId, mark }) => [`${personId}:${documentId}`, mark]),
  );
  // Row-level security shows a person's share rows only to their keeper and to its grantees.
  const marksShown = (personUuid: string) =>
    rows.people.some(({ id, keptByMe }) => id === personUuid && keptByMe) ||
    rows.shares.some((share) => share.personId === personUuid && share.scope === 'checklist');
  const editable = (personUuid: string) =>
    rows.people.some(({ id, keptByMe }) => id === personUuid && keptByMe);
  // An item that does not apply leaves nothing, not even its truth, since that tells a fact.
  const list = (items: readonly DocumentResult[], holder: string) => {
    const holderUuid = uuid(holder);
    const shown = items
      .filter(({ applies }) => applies !== false)
      .map((document) => ({
        ...item(document, holder),
        mark: markOf.get(`${holderUuid}:${document.documentId}`) ?? null,
      }));
    const visible = marksShown(holderUuid);
    return {
      editable: editable(holderUuid),
      marksShown: visible,
      progress: visible
        ? listProgress(shown, (documentId) => markOf.get(`${holderUuid}:${documentId}`)?.state)
        : null,
      items: shown,
    };
  };
  const listed = (listedChecklist: Extract<typeof checklist, { kind: 'listed' }>) => {
    const people = [
      { person: listedChecklist.principal, role: 'principal' as const },
      ...listedChecklist.dependents.map((person) => ({
        person,
        role: person.possible ? ('possible_dependent' as const) : ('dependent' as const),
      })),
    ].map(({ person, role }) => ({
      personId: uuid(person.personId),
      role,
      ...list(person.items, person.personId),
    }));
    const unit = list(listedChecklist.unit, principal);
    const inChecklist = new Set(people.map(({ personId }) => personId));
    const ours = marks.filter(({ personId }) => inChecklist.has(personId));
    const dropped = new Map(
      droppedItems(
        catalog,
        states,
        entry,
        ours.map(({ documentId }) => documentId),
      ).map((each) => [each.documentId, each.title]),
    );
    return {
      kind: 'listed' as const,
      asksNone: entry.version.documents?.length === 0,
      people,
      unit,
      progress: routeProgress([...people, unit].map(({ progress }) => progress)),
      noLongerAsked: ours.flatMap(({ personId, documentId, mark }) => {
        if (!dropped.has(documentId)) return [];
        const old = dropped.get(documentId);
        const shownTitle = old === undefined ? undefined : translated(old);
        return [
          {
            personId,
            documentId,
            title: shownTitle?.text ?? null,
            original: shownTitle?.original ?? null,
            editable: editable(personId),
            mark,
          },
        ];
      }),
    };
  };
  return {
    ...none,
    status: 'active',
    route: { title: title.text, original: title.original, country: entry.version.country },
    version: { number: entry.identity.number },
    newerProposedVersion:
      newerProposedVersion === undefined
        ? null
        : { number: newerProposedVersion.identity.number, from: newerProposedVersion.from },
    documents: checklist.kind === 'not_covered' ? { kind: 'not_covered' } : listed(checklist),
  };
}

export type RouteDocumentsView = NonNullable<ReturnType<typeof caseRouteDocuments>>;
