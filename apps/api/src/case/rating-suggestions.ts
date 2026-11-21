import { type RatingSuggestions, type SuggestedRatings, ratingSuggestions } from '@arca/domain';
import { resources } from '@arca/i18n';

const { compare } = resources['pt-BR'].translation;

/**
 * The suggested stars of the comparison (ADR-0035), found for a personal criterion by its ID and
 * for a criterion the person created by the name the screen gives a ready suggestion or criterion,
 * as the catalog words it. The match runs here, in the API; the names never leave it.
 */
export function comparisonRatingSuggestions(file: SuggestedRatings): RatingSuggestions {
  return ratingSuggestions(file, { ...compare.criterion, ...compare.suggestion });
}
