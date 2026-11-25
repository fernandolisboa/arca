import { maxDocumentBatch } from '@arca/api-contract/client';
import { Button, menuItemClass } from '@arca/ui';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CountryFlag } from './country-flag.js';
import {
  allDocuments,
  unfiledDocuments,
  type CountryShelves,
  type CountryView,
} from './document-countries.js';
import { CheckRow } from './forms/check-row.js';
import { CountryPickButton, type CountryOptionGroup } from './forms/country-field.js';
import { textLinkClass } from './forms/text-link.js';

/**
 * The views of the documents list: every document, each country with a document and those under
 * no country, then the picker for one more country. Chips in a row on a phone, a column beside the
 * list on a wide screen.
 */
export function CountryRail({
  shelves,
  view,
  countryName,
  groups,
  onView,
}: {
  readonly shelves: CountryShelves;
  readonly view: CountryView;
  readonly countryName: (code: string) => string;
  readonly groups: readonly CountryOptionGroup[];
  readonly onView: (view: CountryView) => void;
}) {
  const { t, i18n } = useTranslation();
  const items = [
    { view: allDocuments, name: t('vault.documents.countries.all'), count: shelves.total },
    ...shelves.countries
      .map(({ code, count }) => ({ view: code, name: countryName(code), count, code }))
      .sort((left, right) => left.name.localeCompare(right.name, i18n.language)),
    // Until a first document is under a country, "under none" would only repeat "all".
    ...(view === unfiledDocuments || (shelves.unfiled > 0 && shelves.unfiled < shelves.total)
      ? [
          {
            view: unfiledDocuments,
            name: t('vault.documents.countries.unfiled'),
            count: shelves.unfiled,
          },
        ]
      : []),
  ];
  return (
    <nav aria-label={t('vault.documents.countries.label')}>
      <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
        {items.map((item) => (
          <li key={item.view}>
            <button
              type="button"
              aria-pressed={item.view === view}
              data-current={item.view === view || undefined}
              className={menuItemClass}
              onClick={() => {
                onView(item.view);
              }}
            >
              {'code' in item && <CountryFlag code={item.code} />}
              <span className="min-w-0 flex-1 lg:break-words">{item.name}</span>
              <span className="sr-only">: </span>
              <span className="text-small text-muted tabular-nums">{item.count}</span>
              <span className="sr-only">
                {t('vault.documents.countries.tally', { count: item.count })}
              </span>
            </button>
          </li>
        ))}
        <li>
          <CountryPickButton
            label={t('vault.documents.countries.chooseLabel')}
            className={`${textLinkClass} px-3`}
            groups={groups}
            onPick={onView}
          >
            {t('vault.documents.countries.choose')}
          </CountryPickButton>
        </li>
      </ul>
    </nav>
  );
}

/**
 * A document's countries as chips. Its owner takes one off with the chip itself and adds another
 * from the picker; an account it is shared with only reads them.
 */
export function DocumentCountryChips({
  countries,
  name,
  editable,
  disabled,
  countryName,
  groups,
  onChange,
}: {
  readonly countries: readonly string[];
  /** The document's name, which names the picker. */
  readonly name: string;
  readonly editable: boolean;
  readonly disabled: boolean;
  readonly countryName: (code: string) => string;
  readonly groups: readonly CountryOptionGroup[];
  readonly onChange: (country: string, filed: boolean) => void;
}) {
  const { t } = useTranslation();
  if (!editable && countries.length === 0) return null;
  const chipClass =
    'inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-soft px-2.5 text-small';
  const offered = groups.map((group) => ({
    ...group,
    options: group.options.filter(({ value }) => !countries.includes(value)),
  }));
  return (
    <ul
      aria-label={t('vault.documents.countries.of')}
      className="flex flex-wrap items-center gap-2"
    >
      {countries.map((code) => (
        <li key={code}>
          {editable ? (
            <button
              type="button"
              disabled={disabled}
              aria-label={t('vault.documents.countries.remove', { country: countryName(code) })}
              className={`${chipClass} hover:border-danger-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60`}
              onClick={() => {
                onChange(code, false);
              }}
            >
              <CountryFlag code={code} />
              {countryName(code)}
              <span aria-hidden="true" className="text-muted">
                ×
              </span>
            </button>
          ) : (
            <span className={chipClass}>
              <CountryFlag code={code} />
              {countryName(code)}
            </span>
          )}
        </li>
      ))}
      {editable && (
        <li>
          <CountryPickButton
            label={t('vault.documents.countries.useInLabel', { name })}
            className={`${textLinkClass} min-h-8 text-small`}
            disabled={disabled}
            groups={offered}
            onPick={(country) => {
              onChange(country, true);
            }}
          >
            {t('vault.documents.countries.useIn')}
          </CountryPickButton>
        </li>
      )}
    </ul>
  );
}

/** The vault's documents a country does not hold yet, to mark and bring under it together. */
export function BringFromVault({
  candidates,
  disabled,
  onBring,
  onCancel,
}: {
  readonly candidates: readonly { readonly id: string; readonly name: string }[];
  readonly disabled: boolean;
  readonly onBring: (documentIds: readonly string[]) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    onBring([...chosen]);
  };
  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
    >
      {candidates.length === 0 ? (
        <p className="text-muted">{t('vault.documents.countries.bringNone')}</p>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-medium">{t('vault.documents.countries.bringLegend')}</legend>
          {candidates.length > maxDocumentBatch && (
            <p className="text-small text-muted">
              {t('vault.documents.countries.bringLimit', { count: maxDocumentBatch })}
            </p>
          )}
          <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
            {candidates.map(({ id, name }) => (
              <CheckRow
                key={id}
                label={name}
                checked={chosen.has(id)}
                disabled={!chosen.has(id) && chosen.size >= maxDocumentBatch}
                onChange={(checked) => {
                  setChosen((before) => {
                    const next = new Set(before);
                    if (checked) next.add(id);
                    else next.delete(id);
                    return next;
                  });
                }}
              />
            ))}
          </div>
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {candidates.length > 0 && (
          <Button type="submit" disabled={disabled || chosen.size === 0}>
            {t('vault.documents.countries.bringSubmit', { count: chosen.size })}
          </Button>
        )}
        <button type="button" className={textLinkClass} onClick={onCancel}>
          {t('vault.documents.countries.bringCancel')}
        </button>
      </div>
    </form>
  );
}
