import {
  SearchPickButton,
  SearchPicker,
  type SearchPickButtonProps,
  type SearchPickerGroup,
  type SearchPickerProps,
} from '@arca/ui';
import { useTranslation } from 'react-i18next';
import { CountryFlag } from '../country-flag.js';

export type CountryFieldProps = Pick<
  SearchPickerProps,
  'label' | 'hint' | 'value' | 'onChange' | 'placeholder' | 'clearLabel' | 'groups'
>;

/** Countries shown together, under a title when they are not the plain list. */
export type CountryOptionGroup = SearchPickerGroup;

const flag = (code: string) => <CountryFlag code={code} />;

const usePickerLabels = () => {
  const { t } = useTranslation();
  return {
    search: t('countryPicker.search'),
    none: t('countryPicker.none'),
    clear: t('countryPicker.clear'),
    close: t('countryPicker.close'),
  };
};

/**
 * A country choice: the search picker over the countries in a grid, each with its flag, which a
 * native select cannot draw (ADR-0033).
 */
export function CountryField(props: CountryFieldProps) {
  return <SearchPicker {...props} labels={usePickerLabels()} lead={flag} layout="grid" />;
}

/**
 * A button that opens the country picker for one more country, where the countries already chosen
 * show elsewhere, such as a document's countries.
 */
export function CountryPickButton(
  props: Pick<
    SearchPickButtonProps,
    'label' | 'className' | 'disabled' | 'groups' | 'onPick' | 'children'
  >,
) {
  return <SearchPickButton {...props} labels={usePickerLabels()} lead={flag} layout="grid" />;
}
