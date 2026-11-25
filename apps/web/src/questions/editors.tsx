import {
  choiceSets,
  currencyCodes,
  languageCodes,
  type FieldInput,
  type QuestionField,
  type QuestionInput,
} from '@arca/api-contract/client';
import type { Messages } from '@arca/i18n';
import { Button, ChoiceGroup, SearchPicker } from '@arca/ui';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CountryField } from '../forms/country-field.js';
import { dangerLinkClass, textLinkClass } from '../forms/text-link.js';
import { SelectField } from '../forms/select-field.js';
import { TextField } from '../forms/text-field.js';
import { formatAmount, formatDateValue } from './format.js';
import {
  amountText,
  amountValue,
  dateParts,
  isRecord,
  joinDate,
  noDate,
  percentFromShare,
  shareFromPercent,
} from './entry.js';

/**
 * Editors for the guided questions (spec 0007, R4), one per input kind of the flow. A value is
 * the answer as the API takes it; `undefined` is not answered yet and `null` is "Não sei".
 */

export interface QuestionContext {
  readonly personId: string;
  readonly names: ReadonlyMap<string, string>;
  readonly countries: readonly string[];
  readonly formerCountries: readonly string[];
  readonly occupations: readonly string[];
  readonly studyFields: readonly string[];
  /** The businesses the person owns a confirmed share of, as the assets question lists them. */
  readonly businesses: readonly Business[];
}

export interface Business {
  readonly id: string;
  readonly country?: string;
  readonly operatingSince?: string;
}

/** The businesses among the person's assets, as the assets question answers them. */
export function businessesOf(assets: unknown): Business[] {
  if (!Array.isArray(assets)) return [];
  return assets.filter(isRecord).flatMap((asset) => {
    const { id, kind, country, operatingSince } = asset;
    if (kind !== 'business' || typeof id !== 'string') return [];
    return [
      {
        id,
        ...(typeof country === 'string' ? { country } : {}),
        ...(typeof operatingSince === 'string' ? { operatingSince } : {}),
      },
    ];
  });
}

type FieldKey = keyof Messages['questions']['fields'];
type Record_ = Readonly<Record<string, unknown>>;

const unknownValue = '?';
const yesNo = { yes: 'yes', no: 'no', unknown: 'unknown' } as const;
type YesNo = (typeof yesNo)[keyof typeof yesNo];
const noneDate = 'none';
const yearPattern = '\\d{4}';
// The stored limit of a display name (`displayNameSchema`).
const labelLength = 80;
const scalar = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const countPattern = /^[0-9]{1,8}$/;
// Offered first in the language picker: Portuguese, then the languages of the usual destinations.
const commonLanguages: readonly string[] = ['pt', 'en', 'es', 'it', 'fr', 'de'];
// A choice with this many answers or fewer shows them all as buttons instead of a list.
const fewChoices = 3;

export function useNames() {
  const { t, i18n } = useTranslation();
  const regions = new Intl.DisplayNames([i18n.language], { type: 'region', fallback: 'code' });
  const languages = new Intl.DisplayNames([i18n.language], { type: 'language', fallback: 'code' });
  const currencies = new Intl.DisplayNames([i18n.language], { type: 'currency', fallback: 'code' });
  const sorted = (options: { value: string; label: string }[]) =>
    options.sort((left, right) => left.label.localeCompare(right.label, i18n.language));
  /** A classification's codes by name, under the group their first `prefix` digits name. */
  const classified = (
    codes: readonly string[],
    classification: 'occupations' | 'studyFields',
    prefix: number,
  ) => {
    const named = (key: string, fallback: string) =>
      i18n.exists(key) ? t(key as 'occupations.2211') : fallback;
    const groups = classification === 'occupations' ? 'occupationGroups' : 'studyFieldGroups';
    return Object.entries(
      Object.groupBy(
        codes.map((code) => ({ value: code, label: named(`${classification}.${code}`, code) })),
        ({ value }) => value.slice(0, prefix),
      ),
    )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([group, options = []]) => ({
        title: named(`${groups}.${group}`, group),
        options: sorted(options),
      }));
  };
  return {
    country: (code: string) => {
      const former = `formerCountries.${code}`;
      return i18n.exists(former) ? t(former as 'formerCountries.SUHH') : (regions.of(code) ?? code);
    },
    language: (code: string) => languages.of(code) ?? code,
    countryOptions: (codes: readonly string[]) =>
      sorted(codes.map((code) => ({ value: code, label: regions.of(code) ?? code }))),
    /** The languages the locale can name, the most asked first; a bare code helps nobody. */
    languageGroups: (commonTitle: string) => {
      const named = languageCodes.flatMap((code) => {
        const label = languages.of(code);
        return label === undefined || label === code ? [] : [{ value: code, label }];
      });
      return [
        {
          title: commonTitle,
          options: named.filter(({ value }) => commonLanguages.includes(value)),
        },
        { options: sorted(named.filter(({ value }) => !commonLanguages.includes(value))) },
      ];
    },
    currencyOptions: () =>
      currencyCodes.map((code) => ({
        value: code,
        label: `${code} · ${currencies.of(code) ?? code}`,
      })),
    // ISCO-08 codes under their major group, the code's first digit.
    occupationGroups: (codes: readonly string[]) => classified(codes, 'occupations', 1),
    // ISCED-F 2013 detailed fields under their broad field, the code's first two digits.
    studyFieldGroups: (codes: readonly string[]) => classified(codes, 'studyFields', 2),
    field: (key: string, question: string) => {
      const specific = `questions.fieldFor.${question}.${key}`;
      if (i18n.exists(specific)) return t(specific as 'questions.fieldFor.assets.country');
      return i18n.exists(`questions.fields.${key}`)
        ? t(`questions.fields.${key as FieldKey}`, { question })
        : key;
    },
  };
}

export function FieldEditor({
  questionId,
  fieldKey,
  label,
  hint,
  input,
  value,
  optional,
  onChange,
  context,
  labelHidden = false,
}: {
  readonly questionId: string;
  readonly fieldKey: string;
  readonly label: string;
  readonly hint?: string;
  readonly input: FieldInput;
  readonly value: unknown;
  readonly optional: boolean;
  readonly onChange: (value: unknown) => void;
  readonly context: QuestionContext;
  /** Keeps the field's own label for screen readers only, where the screen shows the question. */
  readonly labelHidden?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const names = useNames();
  const unknownOption = optional ? [{ value: unknownValue, label: t('questions.unknown') }] : [];
  const chosenValue = value === null ? unknownValue : scalar(value);
  const choose = (chosen: string) => {
    onChange(chosen === '' ? undefined : chosen === unknownValue ? null : chosen);
  };
  const pick = (options: readonly { value: string; label: string }[]) => (
    <SelectField
      label={label}
      labelHidden={labelHidden}
      {...(hint === undefined ? {} : { hint })}
      placeholder={t('questions.pick')}
      value={chosenValue}
      options={[...options, ...unknownOption]}
      onChange={choose}
    />
  );
  switch (input.kind) {
    case 'country': {
      const former = input.formerStates === true ? context.formerCountries : [];
      return (
        <CountryField
          label={label}
          labelHidden={labelHidden}
          {...(hint === undefined ? {} : { hint })}
          placeholder={t('questions.pick')}
          value={chosenValue}
          groups={[
            { options: names.countryOptions(context.countries) },
            {
              title: t('questions.formerCountries'),
              options: former.map((code) => ({ value: code, label: names.country(code) })),
            },
            { options: unknownOption },
          ]}
          onChange={choose}
        />
      );
    }
    case 'language':
      return (
        <SearchPicker
          label={label}
          labelHidden={labelHidden}
          {...(hint === undefined ? {} : { hint })}
          placeholder={t('questions.pick')}
          value={chosenValue}
          groups={[
            ...names.languageGroups(t('questions.languagePicker.common')),
            { options: unknownOption },
          ]}
          labels={{
            search: t('questions.languagePicker.search'),
            none: t('questions.languagePicker.none'),
            clear: t('questions.languagePicker.clear'),
            close: t('questions.languagePicker.close'),
          }}
          layout="list"
          onChange={choose}
        />
      );
    case 'choice': {
      const values: readonly (string | number)[] = choiceSets[input.set];
      if (values.length <= fewChoices) {
        return (
          <ChoiceGroup
            inline
            legendHidden={labelHidden}
            legend={label}
            {...(hint === undefined ? {} : { description: hint })}
            choices={[
              ...values.map((choice) => ({
                value: String(choice),
                label: t(`questions.choice.${input.set}`, { value: String(choice) }),
              })),
              ...unknownOption,
            ]}
            value={chosenValue}
            onChange={(chosen) => {
              onChange(values.find((choice) => String(choice) === chosen) ?? null);
            }}
          />
        );
      }
      return (
        <SelectField
          label={label}
          labelHidden={labelHidden}
          {...(hint === undefined ? {} : { hint })}
          placeholder={t('questions.pick')}
          value={value === null ? unknownValue : scalar(value)}
          options={[
            ...values.map((choice) => ({
              value: String(choice),
              label: t(`questions.choice.${input.set}`, { value: String(choice) }),
            })),
            ...unknownOption,
          ]}
          onChange={(chosen) => {
            const found = values.find((choice) => String(choice) === chosen);
            onChange(found ?? (chosen === unknownValue ? null : undefined));
          }}
        />
      );
    }
    case 'yesNo':
      return (
        <ChoiceGroup<YesNo | ''>
          inline
          legendHidden={labelHidden}
          legend={label}
          {...(hint === undefined ? {} : { description: hint })}
          choices={[
            { value: yesNo.yes, label: t('questions.yes') },
            { value: yesNo.no, label: t('questions.no') },
            ...(optional ? [{ value: yesNo.unknown, label: t('questions.unknown') }] : []),
          ]}
          value={yesNoOf(value)}
          onChange={(chosen) => {
            onChange(chosen === yesNo.yes ? true : chosen === yesNo.no ? false : null);
          }}
        />
      );
    case 'date':
      return (
        <DateEditor
          noneLabel={t('questions.date.none', { field: fieldKey, question: questionId })}
          label={label}
          labelHidden={labelHidden}
          {...(hint === undefined ? {} : { hint })}
          input={input}
          value={value}
          optional={optional}
          onChange={onChange}
        />
      );
    case 'occupation':
    case 'studyField': {
      const [groups, picker] =
        input.kind === 'occupation'
          ? [names.occupationGroups(context.occupations), 'occupationPicker' as const]
          : [names.studyFieldGroups(context.studyFields), 'studyFieldPicker' as const];
      return (
        <SearchPicker
          label={label}
          labelHidden={labelHidden}
          {...(hint === undefined ? {} : { hint })}
          placeholder={t('questions.pick')}
          value={chosenValue}
          groups={[...groups, { options: unknownOption }]}
          labels={{
            search: t(`questions.${picker}.search`),
            none: t(`questions.${picker}.none`),
            clear: t(`questions.${picker}.clear`),
            close: t(`questions.${picker}.close`),
          }}
          layout="list"
          onChange={choose}
        />
      );
    }
    case 'label':
      return (
        <LabelEditor
          label={label}
          labelHidden={labelHidden}
          hint={t('questions.labelHint')}
          value={value}
          onChange={onChange}
        />
      );
    case 'business':
      return context.businesses.length === 0 ? (
        <p className="text-small text-muted">{t('questions.business.noneOwned')}</p>
      ) : (
        pick(
          context.businesses.map((business, index) => ({
            value: business.id,
            label: t('questions.business.option', {
              number: index + 1,
              country: business.country === undefined ? 'none' : names.country(business.country),
              since:
                business.operatingSince === undefined
                  ? 'none'
                  : formatDateValue(business.operatingSince, i18n.language),
            }),
          })),
        )
      );
    case 'count':
      return (
        <TextField
          label={label}
          labelHidden={labelHidden}
          {...(hint === undefined ? {} : { hint })}
          inputMode="numeric"
          autoComplete="off"
          value={scalar(value)}
          onChange={(event) => {
            const typed = event.currentTarget.value.trim();
            onChange(typed === '' ? undefined : countPattern.test(typed) ? Number(typed) : typed);
          }}
        />
      );
    case 'money':
      return (
        <MoneyEditor
          label={label}
          labelHidden={labelHidden}
          value={value}
          optional={optional}
          onChange={onChange}
        />
      );
    case 'share':
      return (
        <TextField
          label={label}
          labelHidden={labelHidden}
          inputMode="decimal"
          autoComplete="off"
          value={typeof value === 'string' ? percentFromShare(value) : ''}
          onChange={(event) => {
            onChange(shareFromPercent(event.currentTarget.value) ?? event.currentTarget.value);
          }}
        />
      );
  }
}

const yesNoOf = (value: unknown): YesNo | '' =>
  value === true ? yesNo.yes : value === false ? yesNo.no : value === null ? yesNo.unknown : '';

/** A short name, sent without outer spaces; left empty, the item has none. */
function LabelEditor({
  label,
  labelHidden,
  hint,
  value,
  onChange,
}: {
  readonly label: string;
  readonly labelHidden: boolean;
  readonly hint: string;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
}) {
  const [text, setText] = useState(() => (typeof value === 'string' ? value : ''));
  return (
    <TextField
      label={label}
      labelHidden={labelHidden}
      hint={hint}
      autoComplete="off"
      maxLength={labelLength}
      value={text}
      onChange={(event) => {
        const typed = event.currentTarget.value;
        setText(typed);
        const trimmed = typed.trim();
        onChange(trimmed === '' ? undefined : trimmed);
      }}
    />
  );
}

function DateEditor({
  noneLabel,
  label,
  labelHidden,
  hint,
  input,
  value,
  optional,
  onChange,
}: {
  readonly noneLabel: string;
  readonly label: string;
  readonly labelHidden: boolean;
  readonly hint?: string;
  readonly input: Extract<FieldInput, { kind: 'date' }>;
  readonly value: unknown;
  readonly optional: boolean;
  readonly onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const legendId = useId();
  const [parts, setParts] = useState(() => dateParts(value));
  const set = (next: typeof parts) => {
    setParts(next);
    onChange(joinDate(next));
  };
  // The browser refuses a half-typed date before the step is sent, so it never goes as "Não sei".
  const fullDate = input.precision === 'day' && parts.year !== '';
  const months = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
  const days = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, '0'));
  return (
    <fieldset className="flex flex-col gap-2" aria-labelledby={legendId}>
      <legend id={legendId} className={labelHidden ? 'sr-only' : 'font-medium'}>
        {label}
      </legend>
      {hint !== undefined && (
        <p className={labelHidden ? 'sr-only' : '-mt-1 text-small text-muted'}>{hint}</p>
      )}
      {value !== null && value !== noneDate && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <TextField
            label={t('questions.date.year')}
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            pattern={yearPattern}
            title={t('questions.date.yearFormat')}
            required={parts.month !== '' || parts.day !== ''}
            value={parts.year}
            onChange={(event) => {
              set({ ...parts, year: event.currentTarget.value.replace(/\D/g, '') });
            }}
          />
          <SelectField
            label={t('questions.date.month')}
            value={parts.month}
            options={[
              ...(input.precision === 'day'
                ? []
                : [{ value: '', label: t('questions.date.anyMonth') }]),
              ...months.map((month) => ({
                value: month,
                label: t('questions.date.months', { month }),
              })),
            ]}
            {...(input.precision === 'day' ? { placeholder: t('questions.pick') } : {})}
            required={fullDate}
            onChange={(month) => {
              set({ ...parts, month, day: month === '' ? '' : parts.day });
            }}
          />
          {(parts.month !== '' || input.precision === 'day') && (
            <SelectField
              label={t('questions.date.day')}
              value={parts.day}
              options={[
                ...(input.precision === 'day'
                  ? []
                  : [{ value: '', label: t('questions.date.anyDay') }]),
                ...days.map((day) => ({ value: day, label: String(Number(day)) })),
              ]}
              {...(input.precision === 'day' ? { placeholder: t('questions.pick') } : {})}
              required={fullDate}
              onChange={(day) => {
                set({ ...parts, day });
              }}
            />
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-4">
        {input.none === true && (
          <Check
            label={noneLabel}
            checked={value === noneDate}
            onChange={(checked) => {
              if (checked) onChange(noneDate);
              else set(noDate);
            }}
          />
        )}
        {optional && (
          <Check
            label={t('questions.unknown')}
            checked={value === null}
            onChange={(checked) => {
              if (checked) onChange(null);
              else set(noDate);
            }}
          />
        )}
      </div>
    </fieldset>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-touch items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        className="size-4 accent-(--arca-primary)"
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
      />
      {label}
    </label>
  );
}

/** An amount and its currency; an optional one left empty is not answered, and may be "Não sei". */
function MoneyEditor({
  label,
  labelHidden,
  value,
  optional,
  onChange,
}: {
  readonly label: string;
  readonly labelHidden: boolean;
  readonly value: unknown;
  readonly optional: boolean;
  readonly onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const names = useNames();
  const money = isRecord(value) ? value : {};
  const amount = typeof money['amount'] === 'string' ? money['amount'] : '';
  // An optional amount left empty sends nothing, so the chosen currency is kept here until then.
  const [chosenCurrency, setCurrency] = useState('BRL');
  const currency = typeof money['currency'] === 'string' ? money['currency'] : chosenCurrency;
  const [text, setText] = useState(() => amountText(amount));
  const send = (typed: string, chosen: string) => {
    onChange(
      optional && typed.trim() === ''
        ? undefined
        : { amount: amountValue(typed), currency: chosen },
    );
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={labelHidden ? 'sr-only' : 'font-medium'}>{label}</legend>
      {value !== null && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <TextField
            label={t('questions.amount')}
            inputMode="decimal"
            autoComplete="off"
            value={text}
            onChange={(event) => {
              setText(event.currentTarget.value);
              send(event.currentTarget.value, currency);
            }}
          />
          <SelectField
            label={t('questions.currency')}
            value={currency}
            options={names.currencyOptions()}
            onChange={(chosen) => {
              setCurrency(chosen);
              send(text, chosen);
            }}
          />
        </div>
      )}
      {optional && (
        <Check
          label={t('questions.unknown')}
          checked={value === null}
          onChange={(checked) => {
            onChange(checked ? null : undefined);
            if (!checked) setText('');
          }}
        />
      )}
    </fieldset>
  );
}

function ItemFields({
  questionId,
  fields,
  item,
  onChange,
  context,
}: {
  readonly questionId: string;
  readonly fields: readonly QuestionField[];
  readonly item: Record_;
  readonly onChange: (item: Record_) => void;
  readonly context: QuestionContext;
}) {
  const names = useNames();
  const asked = (field: QuestionField, values: Record_) =>
    field.onlyWhen === undefined || values[field.onlyWhen.key] === field.onlyWhen.value;
  return (
    <>
      {fields
        .filter((field) => asked(field, item))
        .map(({ key, input, optional }) => (
          <FieldEditor
            key={key}
            questionId={questionId}
            fieldKey={key}
            label={names.field(key, questionId)}
            input={input}
            value={item[key]}
            optional={optional}
            context={context}
            onChange={(next) => {
              // "Não sei" stays in the draft as null until the step is sent (`sentAnswer`).
              const rest = Object.fromEntries(
                Object.entries(item).filter(([field]) => field !== key),
              );
              const changed = next === undefined ? rest : { ...rest, [key]: next };
              // A field no longer asked, such as a business's country once the asset is not one, goes.
              const unasked = new Set(
                fields.filter((field) => !asked(field, changed)).map((field) => field.key),
              );
              onChange(
                Object.fromEntries(
                  Object.entries(changed).filter(([field]) => !unasked.has(field)),
                ),
              );
            }}
          />
        ))}
    </>
  );
}

/** An item's answered fields as short phrases, in the question's order, for its collapsed row. */
function useItemSummary(questionId: string, fields: readonly QuestionField[]) {
  const { t, i18n } = useTranslation();
  const names = useNames();
  const phrase = (key: string, input: FieldInput, value: unknown): string | undefined => {
    if (value === null || value === undefined || value === '') return undefined;
    switch (input.kind) {
      case 'country':
        return typeof value === 'string' ? names.country(value) : undefined;
      case 'language':
        return typeof value === 'string' ? names.language(value) : undefined;
      case 'choice':
        return typeof value === 'string' || typeof value === 'number'
          ? t(`questions.choice.${input.set}`, { value: String(value) })
          : undefined;
      case 'occupation':
        return typeof value === 'string' && i18n.exists(`occupations.${value}`)
          ? t(`occupations.${value}` as 'occupations.2211')
          : undefined;
      case 'studyField':
        return typeof value === 'string' && i18n.exists(`studyFields.${value}`)
          ? t(`studyFields.${value}` as 'studyFields.0912')
          : undefined;
      case 'label':
        return typeof value === 'string' ? value : undefined;
      case 'date':
        return typeof value === 'string'
          ? t('questions.summary.date', {
              field: key,
              question: questionId,
              date: value === noneDate ? 'none' : formatDateValue(value, i18n.language),
            })
          : undefined;
      case 'money':
        return isRecord(value) &&
          typeof value['amount'] === 'string' &&
          typeof value['currency'] === 'string' &&
          value['amount'] !== ''
          ? formatAmount({ amount: value['amount'], currency: value['currency'] }, i18n.language)
          : undefined;
      case 'share':
        return typeof value === 'string' && shareFromPercent(percentFromShare(value)) !== undefined
          ? `${percentFromShare(value)}%`
          : undefined;
      default:
        return undefined;
    }
  };
  return (item: Record_): readonly string[] =>
    fields.flatMap(({ key, input }) => phrase(key, input, item[key]) ?? []);
}

/** Whether an item still lacks an answer its question needs, so it opens for editing. */
const lacksNeeded = (fields: readonly QuestionField[], item: Record_) =>
  fields.some(
    (field) =>
      !field.optional &&
      (field.onlyWhen === undefined || item[field.onlyWhen.key] === field.onlyWhen.value) &&
      item[field.key] === undefined,
  );

/**
 * A list question: each item a row that opens to edit, a button to add one, and, while nothing is
 * listed, "none" or "Não sei" as quieter answers.
 */
function ListEditor({
  questionId,
  legend,
  hint,
  fields,
  value,
  canBeUnknown,
  onChange,
  context,
}: {
  readonly questionId: string;
  readonly legend: string;
  readonly hint?: string;
  readonly fields: readonly QuestionField[];
  readonly value: unknown;
  readonly canBeUnknown: boolean;
  readonly onChange: (value: unknown) => void;
  readonly context: QuestionContext;
}) {
  const { t } = useTranslation();
  const legendId = useId();
  const summary = useItemSummary(questionId, fields);
  const items = Array.isArray(value) ? value.filter(isRecord) : [];
  // Each item keeps its key when another is removed, so its editors keep their own typed text.
  const lastKeyRef = useRef(items.length);
  const [keys, setKeys] = useState(() => items.map((_, index) => index));
  const [open, setOpen] = useState<ReadonlySet<number>>(
    () => new Set(items.flatMap((item, index) => (lacksNeeded(fields, item) ? [index] : []))),
  );
  const keyAt = (index: number) => keys[index] ?? -1 - index;
  const toggle = (key: number, opened: boolean) => {
    const next = new Set(open);
    if (opened) next.add(key);
    else next.delete(key);
    setOpen(next);
  };
  const add = () => {
    lastKeyRef.current += 1;
    const key = lastKeyRef.current;
    setKeys([...keys, key]);
    toggle(key, true);
    onChange([...items, {}]);
  };
  // A list that cannot be "Não sei", such as assets, always reads as a list: empty is nothing yet.
  const settled = canBeUnknown && (value === null || (Array.isArray(value) && items.length === 0));
  return (
    <fieldset className="flex flex-col gap-3" aria-labelledby={legendId}>
      <legend id={legendId} className="sr-only">
        {legend}
      </legend>
      {hint !== undefined && <p className="sr-only">{hint}</p>}
      {items.length > 0 && (
        <ol className="flex flex-col gap-2">
          {items.map((item, index) => {
            const key = keyAt(index);
            const phrases = summary(item);
            const title =
              phrases.slice(0, 2).join(' · ') ||
              t('questions.list.item', { question: questionId, number: index + 1 });
            const rest = phrases.slice(2).join(' · ');
            return (
              <li
                key={key}
                className={`flex flex-col gap-3 rounded-control border bg-surface p-3 ${open.has(key) ? 'border-primary' : 'border-line'}`}
              >
                {open.has(key) ? (
                  <>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <ItemFields
                        questionId={questionId}
                        fields={fields}
                        item={item}
                        context={context}
                        onChange={(next) => {
                          onChange(items.map((entry, at) => (at === index ? next : entry)));
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        className={dangerLinkClass}
                        onClick={() => {
                          setKeys(keys.filter((_, at) => at !== index));
                          toggle(key, false);
                          onChange(items.filter((_, at) => at !== index));
                        }}
                      >
                        {t('questions.list.remove')}
                      </button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          toggle(key, false);
                        }}
                      >
                        {t('questions.list.done')}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{title}</p>
                      {rest !== '' && <p className="text-small text-muted">{rest}</p>}
                    </div>
                    <button
                      type="button"
                      className={textLinkClass}
                      aria-label={t('questions.list.editItem', { item: title })}
                      onClick={() => {
                        toggle(key, true);
                      }}
                    >
                      {t('questions.list.edit')}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {settled ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            {value === null
              ? t('questions.unknown')
              : t('questions.list.none', { question: questionId })}
          </span>
          <button
            type="button"
            className={textLinkClass}
            onClick={() => {
              onChange(undefined);
            }}
          >
            {t('questions.list.change')}
          </button>
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="button" variant="secondary" onClick={add}>
            {t('questions.list.add', { question: questionId })}
          </Button>
          {items.length === 0 && canBeUnknown && (
            <span className="flex flex-wrap items-center gap-x-3 text-small text-muted">
              {t('questions.list.or')}
              <button
                type="button"
                className={textLinkClass}
                onClick={() => {
                  onChange([]);
                }}
              >
                {t('questions.list.none', { question: questionId })}
              </button>
              <button
                type="button"
                className={textLinkClass}
                onClick={() => {
                  onChange(null);
                }}
              >
                {t('questions.unknown')}
              </button>
            </span>
          )}
        </div>
      )}
    </fieldset>
  );
}

export function QuestionEditor({
  questionId,
  input,
  legend,
  hint,
  value,
  related,
  canBeUnknown,
  onChange,
  context,
}: {
  readonly questionId: string;
  readonly input: QuestionInput;
  readonly legend: string;
  readonly hint?: string;
  readonly value: unknown;
  readonly related?: readonly string[];
  readonly canBeUnknown: boolean;
  readonly onChange: (value: unknown) => void;
  readonly context: QuestionContext;
}) {
  const { t } = useTranslation();
  const hinted = hint === undefined ? {} : { hint };
  switch (input.kind) {
    case 'list':
      return (
        <ListEditor
          questionId={questionId}
          legend={legend}
          {...hinted}
          fields={input.fields}
          value={value}
          canBeUnknown={canBeUnknown}
          onChange={onChange}
          context={context}
        />
      );
    case 'people':
      return <PeopleEditor legend={legend} value={value} onChange={onChange} context={context} />;
    case 'complete': {
      const names = (related ?? []).map((id) => context.names.get(id) ?? '');
      const listed =
        names.length === 0
          ? t('questions.relatedNone')
          : t('questions.related', {
              names: new Intl.ListFormat(undefined, { type: 'conjunction' }).format(names),
            });
      return (
        <ChoiceGroup
          inline
          legendHidden
          legend={legend}
          before={<p className="text-muted">{listed}</p>}
          choices={[
            { value: 'yes', label: t('questions.complete.yes') },
            { value: 'no', label: t('questions.complete.no') },
          ]}
          value={value === true ? 'yes' : value === false ? 'no' : ''}
          onChange={(chosen) => {
            onChange(chosen === 'yes');
          }}
        />
      );
    }
    case 'relationships':
      return (
        <RelationshipsEditor
          questionId={questionId}
          legend={legend}
          {...hinted}
          input={input}
          value={value}
          onChange={onChange}
          context={context}
        />
      );
    default:
      return (
        <FieldEditor
          questionId={questionId}
          fieldKey=""
          label={legend}
          {...hinted}
          input={input}
          value={value}
          optional
          onChange={onChange}
          context={context}
          labelHidden
        />
      );
  }
}

function PeopleEditor({
  legend,
  value,
  onChange,
  context,
}: {
  readonly legend: string;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly context: QuestionContext;
}) {
  const { t } = useTranslation();
  const chosen = Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string')
    : [];
  const [mode, setMode] = useState<'some' | 'nobody' | 'unknown' | ''>(() =>
    value === null
      ? 'unknown'
      : !Array.isArray(value)
        ? ''
        : chosen.length === 0
          ? 'nobody'
          : 'some',
  );
  const others = [...context.names].filter(([id]) => id !== context.personId);
  return (
    <div className="flex flex-col gap-3">
      <ChoiceGroup
        inline
        legendHidden
        legend={legend}
        choices={[
          { value: 'some', label: t('questions.people.some') },
          { value: 'nobody', label: t('questions.people.nobody') },
          { value: 'unknown', label: t('questions.unknown') },
        ]}
        value={mode}
        onChange={(next) => {
          setMode(next);
          onChange(next === 'unknown' ? null : next === 'nobody' ? [] : chosen);
        }}
      />
      {mode === 'some' &&
        others.map(([id, name]) => (
          <Check
            key={id}
            label={name}
            checked={chosen.includes(id)}
            onChange={(checked) => {
              onChange(checked ? [...chosen, id] : chosen.filter((other) => other !== id));
            }}
          />
        ))}
    </div>
  );
}

function RelationshipsEditor({
  questionId,
  legend,
  hint,
  input,
  value,
  onChange,
  context,
}: {
  readonly questionId: string;
  readonly legend: string;
  readonly hint?: string;
  readonly input: Extract<QuestionInput, { kind: 'relationships' }>;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly context: QuestionContext;
}) {
  const { t } = useTranslation();
  const rows = Array.isArray(value) ? value.filter(isRecord) : [];
  const name = (id: unknown) => (typeof id === 'string' ? (context.names.get(id) ?? '') : '');
  const title = (row: Record_) => {
    const other = row['from'] === context.personId ? row['to'] : row['from'];
    if (row['kind'] === 'spouse') return t('questions.relation.spouse', { name: name(other) });
    if (row['kind'] === 'partner') return t('questions.relation.partner', { name: name(other) });
    return row['from'] === context.personId
      ? t('questions.relation.parentOf', { name: name(row['to']) })
      : t('questions.relation.childOf', { name: name(row['from']) });
  };
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">{legend}</legend>
      {hint !== undefined && <p className="sr-only">{hint}</p>}
      {rows.length === 0 && <p className="text-muted">{t('questions.noRelationships')}</p>}
      {rows.map((row) => (
        <div
          key={String(row['id'])}
          className="flex flex-col gap-3 rounded-control border border-line p-3"
        >
          <p className="font-medium">{title(row)}</p>
          <ItemFields
            questionId={questionId}
            fields={row['kind'] === 'parent' ? input.parent : input.couple}
            item={row}
            context={context}
            onChange={(next) => {
              onChange(rows.map((entry) => (entry['id'] === row['id'] ? next : entry)));
            }}
          />
        </div>
      ))}
    </fieldset>
  );
}
