import { SearchPicker, type SearchPickerGroup } from '@arca/ui';
import { useTranslation } from 'react-i18next';
import { CountryFlag } from '../country-flag.js';
import { matchesSearch } from './country-search.js';

/** Options shown together, under a title when they are not the plain list of countries. */
export type CountryOptionGroup = SearchPickerGroup;

export interface CountryFieldProps {
  readonly label: string;
  readonly hint?: string;
  /** The chosen option's value, or an empty string while nothing is chosen. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Shown in the field while nothing is chosen. */
  readonly placeholder: string;
  /**
   * The name of the picker's first option, which clears the choice, such as "all countries".
   * Without it, that option shows only while something is chosen, under a general name.
   */
  readonly clearLabel?: string;
  readonly groups: readonly CountryOptionGroup[];
}

const flag = (code: string) => <CountryFlag code={code} />;

/**
 * A country choice: the search picker over the countries in a grid, each with its flag, which a
 * native select cannot draw (ADR-0033).
 */
export function CountryField(props: CountryFieldProps) {
  const { t } = useTranslation();
  return (
    <SearchPicker
      {...props}
      labels={{
        search: t('countryPicker.search'),
        none: t('countryPicker.none'),
        clear: t('countryPicker.clear'),
        close: t('countryPicker.close'),
      }}
      matches={matchesSearch}
      lead={flag}
      layout="grid"
    />
  );
}
