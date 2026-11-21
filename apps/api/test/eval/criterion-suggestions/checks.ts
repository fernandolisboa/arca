import type { SuggestedCriteria } from '@arca/api-contract/routes';
import { plainName as plain } from '@arca/domain';

/** Traits of a place smaller than a country, which a country-level comparison cannot score. */
const placeTraits = /\b(praia|bairro|vizinhan|condominio|quintal|perto de casa|mar\b)/u;

/** Words that would name a country, a visa or a verdict instead of a trait to weigh. */
const offTopic =
  /\b(visto|green card|elegiv|qualifica|portugal|espanha|italia|eua|estados unidos|canada)/u;

/** What is wrong with one answer, as short phrases for the report; empty when it passes. */
export function suggestionProblems(
  { suggestions }: SuggestedCriteria,
  known: readonly string[],
): string[] {
  const knownKeys = new Set(known.map(plain));
  const problems: string[] = [];
  if (suggestions.length < 3) problems.push(`only ${String(suggestions.length)} suggestions`);
  for (const { name } of suggestions) {
    const key = plain(name);
    if (knownKeys.has(key)) problems.push(`repeats the known "${name}"`);
    if (placeTraits.test(key)) problems.push(`a trait of a place, not a country: "${name}"`);
    if (offTopic.test(key)) problems.push(`off topic: "${name}"`);
    if (/\d|https?:|[*#_`]/u.test(name)) problems.push(`digits, a link or markup: "${name}"`);
    if (name.split(/\s+/u).length > 7) problems.push(`over six words: "${name}"`);
  }
  return problems;
}
