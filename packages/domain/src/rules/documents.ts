import type { Duration } from '../calendar/duration.js';
import type { CaseSnapshot } from '../case/snapshot.js';
import { type Truth, and, or } from '../logic/truth.js';
import type { CatalogEntry } from './catalog.js';
import { type VersionContext, prepare } from './context.js';
import { citations } from './engine.js';
import { type Frame, type Trace, evaluate, truthOf } from './evaluate.js';
import type { DocumentItem, Source } from './route-version.js';
import { type Dependent, dependentFrames, unitFrame } from './unit.js';

/** One document item for one person, or for the unit: it applies, may apply, or does not. */
export interface DocumentResult {
  readonly documentId: string;
  readonly title: string;
  readonly kind: string;
  readonly appliesTo: DocumentItem['appliesTo'];
  readonly applies: Truth;
  /** Absent where the sources do not say, as translation and validity. */
  readonly apostille?: boolean;
  readonly translation?: string;
  readonly validity?: Duration;
  readonly note?: string;
  readonly sources: readonly Source[];
  /** What its condition read: none without one, one per edge for a dependent. */
  readonly traces: readonly Trace[];
}

/** The items one person in the unit hands in. */
export interface PersonDocuments {
  readonly personId: string;
  /** A possible dependent: none of their items applies for certain until they are covered. */
  readonly possible: boolean;
  readonly items: readonly DocumentResult[];
}

/**
 * A route version's documents for one case (spec #519). `not_covered` when the version has no
 * document list, so the knowledge base does not know them; a listed version with no items asks
 * for none. Every item is returned with its truth, including those that do not apply.
 */
export type DocumentChecklist =
  | { readonly kind: 'not_covered' }
  | {
      readonly kind: 'listed';
      readonly principal: PersonDocuments;
      /** The unit's dependents, then its possible dependents. */
      readonly dependents: readonly PersonDocuments[];
      /** The items the unit hands in once, such as proof of means. */
      readonly unit: readonly DocumentResult[];
    };

/**
 * The document checklist of one given version for a case, computed in code with the engine's
 * three-valued evaluation (CLAUDE.md rules 2 and 3), over the same unit the evaluation computes.
 */
export function documentChecklist(
  snapshot: CaseSnapshot,
  entry: CatalogEntry,
  principalId: string,
  context: VersionContext,
): DocumentChecklist {
  const prepared = prepare(snapshot, entry, principalId, context);
  const { documents, sources } = prepared.version;
  if (documents === undefined) return { kind: 'not_covered' };
  const { unit, frame } = unitFrame(prepared);
  const cite = citations(sources);
  const result = (
    item: DocumentItem,
    applies: Truth,
    traces: readonly Trace[],
  ): DocumentResult => ({
    documentId: item.id,
    title: item.title,
    kind: item.kind,
    appliesTo: item.appliesTo,
    applies,
    ...(item.apostille === undefined ? {} : { apostille: item.apostille }),
    ...(item.translation === undefined ? {} : { translation: item.translation }),
    ...(item.validity === undefined ? {} : { validity: item.validity }),
    ...(item.note === undefined ? {} : { note: item.note }),
    sources: cite(item.sources),
    traces,
  });
  const at = (item: DocumentItem, read: Frame): DocumentResult => {
    if (item.condition === undefined) return result(item, true, []);
    const trace = evaluate(item.condition, read);
    return result(item, truthOf(trace), [trace]);
  };
  // A dependent reached by several edges hands an item in once: it applies through an edge that
  // covers them and on which its condition holds.
  const forDependent = (item: DocumentItem, dependent: Dependent): DocumentResult => {
    const perEdge = dependentFrames(frame, dependent).map(({ frame: read, holds }) => {
      const evaluated = at(item, read);
      return { applies: and([holds, evaluated.applies]), traces: evaluated.traces };
    });
    return result(
      item,
      or(perEdge.map((edge) => edge.applies)),
      perEdge.flatMap((edge) => edge.traces),
    );
  };
  const of = (appliesTo: DocumentItem['appliesTo']) =>
    documents.filter((item) => item.appliesTo === appliesTo);
  const person = (dependent: Dependent, possible: boolean): PersonDocuments => ({
    personId: dependent.personId,
    possible,
    items: of('each_dependent').map((item) => forDependent(item, dependent)),
  });
  return {
    kind: 'listed',
    principal: {
      personId: principalId,
      possible: false,
      items: of('principal').map((item) => at(item, frame)),
    },
    dependents: [
      ...unit.dependents.map((dependent) => person(dependent, false)),
      ...unit.possibleDependents.map((dependent) => person(dependent, true)),
    ],
    unit: of('unit').map((item) => at(item, frame)),
  };
}
