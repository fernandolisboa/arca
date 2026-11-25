import { SearchPicker, type SearchPickerProps } from '@arca/ui';
import { useTranslation } from 'react-i18next';
import { CountryFlag } from '../country-flag.js';

export type CountryFieldProps = Pick<
  SearchPickerProps,
  'label' | 'hint' | 'value' | 'onChange' | 'placeholder' | 'clearLabel' | 'groups'
>;

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
      lead={flag}
      layout="grid"
    />
  );
}
