import {
  type DocumentGuideEntry,
  type DocumentResult,
  citizenshipsHeldOn,
  decisiveQuestions,
  guideEntriesFor,
  routeDocuments,
  unitsAmount,
} from '@arca/domain';
import { translatedText, viewedSnapshot } from './case-snapshot.js';
import type { EvaluationSettings } from './evaluations.js';
import type { CaseRows } from './view.js';

export interface RouteDocumentsSettings extends Omit<EvaluationSettings, 'routeIds'> {
  /** Where to get each document kind, per issuing country (ADR-0039). */
  readonly guides: readonly DocumentGuideEntry[];
}

/**
 * One route's document checklist for one member as principal (spec #519), from what the viewer
 * sees, as `caseEvaluations` reads it: a hidden fact is an unknown one, so an item that reads it
 * may apply. Only an active version's content leaves (rule 5). Each item is named field by field,
 * so the traces and missing facts, with their case-internal IDs, stay here: what an item depends on
 * leaves as the questions that settle it, as the results' questions do. Null when the principal is
 * not a member of the case.
 */
export function caseRouteDocuments(
  rows: CaseRows,
  routeId: string,
  principalUuid: string,
  { catalog, states, today, engineCommit, texts, guides }: RouteDocumentsSettings,
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
  // An item that does not apply leaves nothing, not even its truth, since that tells a fact.
  const shown = (items: readonly DocumentResult[], holder: string) =>
    items.filter(({ applies }) => applies !== false).map((document) => item(document, holder));
  return {
    ...none,
    status: 'active',
    route: { title: title.text, original: title.original, country: entry.version.country },
    version: { number: entry.identity.number },
    newerProposedVersion:
      newerProposedVersion === undefined
        ? null
        : { number: newerProposedVersion.identity.number, from: newerProposedVersion.from },
    documents:
      checklist.kind === 'not_covered'
        ? { kind: 'not_covered' }
        : {
            kind: 'listed',
            asksNone: entry.version.documents?.length === 0,
            people: [
              { person: checklist.principal, role: 'principal' },
              ...checklist.dependents.map((person) => ({
                person,
                role: person.possible ? 'possible_dependent' : 'dependent',
              })),
            ].map(({ person, role }) => ({
              personId: uuid(person.personId),
              role,
              items: shown(person.items, person.personId),
            })),
            unit: shown(checklist.unit, principal),
          },
  };
}

export type RouteDocumentsView = NonNullable<ReturnType<typeof caseRouteDocuments>>;
