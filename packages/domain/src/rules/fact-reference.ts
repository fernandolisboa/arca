import { type FactDefinition, type FactKey, factCatalog, isFactKey } from '../case/facts.js';

/** Who a fact reference binds to in an expression (spec 0002, R3). */
export type FactTarget = 'current' | 'principal' | 'unit' | 'edge' | 'lineage' | 'ancestor';

export interface ResolvedFact {
  readonly key: FactKey;
  readonly definition: FactDefinition;
  readonly target: FactTarget;
}

/**
 * Maps a reference such as `principal.ageYears` or `lineage.ancestor.citizenships` to its catalog
 * key and who it binds to, or `undefined` when no catalog fact matches. Whether the target is
 * reachable where the reference appears is the checker's concern.
 */
export function resolveFactReference(reference: string): ResolvedFact | undefined {
  const [head, ...rest] = reference.split('.');
  const tail = rest.join('.');
  if (head === 'principal') return lookup(`person.${tail}`, 'principal');
  if (head === 'person') return lookup(reference, 'current');
  if (head === 'unit') return lookup(reference, 'unit');
  if (head === 'edge') return lookup(reference, 'edge');
  if (head !== 'lineage') return undefined;
  if (rest[0] !== 'ancestor') return lookup(reference, 'lineage');
  const suffix = rest.slice(1).join('.');
  return lookup(`person.${suffix}`, 'ancestor') ?? lookup(`lineage.${suffix}`, 'ancestor');
}

/** Every catalog key starts with its scope, so the prefix alone picks the scope. */
function lookup(key: string, target: FactTarget): ResolvedFact | undefined {
  return isFactKey(key) ? { key, definition: factCatalog[key], target } : undefined;
}
