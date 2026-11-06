import {
  choiceSets,
  currencyCodes,
  languageCodes,
  type FieldInput,
  type QuestionField,
  type QuestionInput,
} from '@arca/api-contract/client';
import type { Messages } from '@arca/i18n';
import { Button, ChoiceGroup } from '@arca/ui';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { dangerLinkClass } from '../forms/text-link.js';
import { SelectField } from '../forms/select-field.js';
import { TextField } from '../forms/text-field.js';
import {
  amountText,
  amountValue,
  dateParts,
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
  /** The person the answers are about. */
  readonly personId: string;
  readonly names: ReadonlyMap<string, string>;
  readonly countries: readonly string[];
  readonly formerCountries: readonly string[];
}

type FieldKey = keyof Messages['questions']['fields'];
type Record_ = Readonly<Record<string, unknown>>;

const unknownValue = '?';
/** The radio values of yes, no and "Não sei"; their labels come from i18n. */
const yesNo = { yes: 'yes', no: 'no', unknown: 'unknown' } as const;
type YesNo = (typeof yesNo)[keyof typeof yesNo];
const noneDate = 'none';
const listModes = { has: 'has', none: 'none', unknown: 'unknown' } as const;
const scalar = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const isRecord = (value: unknown): value is Record_ =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function useNames() {
  const { t, i18n } = useTranslation();
  const regions = new Intl.DisplayNames([i18n.language], { type: 'region', fallback: 'code' });
  const languages = new Intl.DisplayNames([i18n.language], { type: 'language', fallback: 'code' });
  const currencies = new Intl.DisplayNames([i18n.language], { type: 'currency', fallback: 'code' });
  const sorted = (options: { value: string; label: string }[]) =>
    options.sort((left, right) => left.label.localeCompare(right.label, i18n.language));
  return {
    country: (code: string) => {
      const former = `formerCountries.${code}`;
      return i18n.exists(former) ? t(former as 'formerCountries.SUHH') : (regions.of(code) ?? code);
    },
    countryOptions: (codes: readonly string[]) =>
      sorted(codes.map((code) => ({ value: code, label: regions.of(code) ?? code }))),
    languageOptions: () =>
      sorted(languageCodes.map((code) => ({ value: code, label: languages.of(code) ?? code }))),
    currencyOptions: () =>
      currencyCodes.map((code) => ({
        value: code,
        label: `${code} · ${currencies.of(code) ?? code}`,
      })),
    field: (key: string) =>
      i18n.exists(`questions.fields.${key}`) ? t(`questions.fields.${key as FieldKey}`) : key,
  };
}

/** One value of a field, with "Não sei" when it may be left out. */
export function FieldEditor({
  fieldKey,
  label,
  hint,
  input,
  value,
  optional,
  onChange,
  context,
}: {
  readonly fieldKey: string;
  readonly label: string;
  readonly hint?: string;
  readonly input: FieldInput;
  readonly value: unknown;
  readonly optional: boolean;
  readonly onChange: (value: unknown) => void;
  readonly context: QuestionContext;
}) {
  const { t } = useTranslation();
  const names = useNames();
  const unknownOption = optional ? [{ value: unknownValue, label: t('questions.unknown') }] : [];
  const pick = (options: readonly { value: string; label: string }[], children?: ReactNode) => (
    <SelectField
      label={label}
      {...(hint === undefined ? {} : { hint })}
      placeholder={t('questions.pick')}
      value={value === null ? unknownValue : scalar(value)}
      options={[...options, ...unknownOption]}
      onChange={(chosen) => {
        onChange(chosen === '' ? undefined : chosen === unknownValue ? null : chosen);
      }}
    >
      {children}
    </SelectField>
  );
  switch (input.kind) {
    case 'country': {
      const former = input.formerStates === true ? context.formerCountries : [];
      return pick(
        names.countryOptions(context.countries),
        former.length === 0 ? undefined : (
          <optgroup label={t('questions.formerCountries')}>
            {former.map((code) => (
              <option key={code} value={code}>
                {names.country(code)}
              </option>
            ))}
          </optgroup>
        ),
      );
    }
    case 'language':
      return pick(names.languageOptions());
    case 'choice': {
      const values: readonly (string | number)[] = choiceSets[input.set];
      return (
        <SelectField
          label={label}
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
          fieldKey={fieldKey}
          label={label}
          {...(hint === undefined ? {} : { hint })}
          input={input}
          value={value}
          optional={optional}
          onChange={onChange}
        />
      );
    case 'money':
      return <MoneyEditor label={label} value={value} onChange={onChange} />;
    case 'share':
      return (
        <TextField
          label={label}
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

function DateEditor({
  fieldKey,
  label,
  hint,
  input,
  value,
  optional,
  onChange,
}: {
  readonly fieldKey: string;
  readonly label: string;
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
  const months = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
  const days = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, '0'));
  return (
    <fieldset className="flex flex-col gap-2" aria-labelledby={legendId}>
      <legend id={legendId} className="font-medium">
        {label}
      </legend>
      {hint !== undefined && <p className="-mt-1 text-small text-muted">{hint}</p>}
      {value !== null && value !== noneDate && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <TextField
            label={t('questions.date.year')}
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
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
            label={t('questions.date.none', { field: fieldKey })}
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

function MoneyEditor({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const names = useNames();
  const money = isRecord(value) ? value : {};
  const amount = typeof money['amount'] === 'string' ? money['amount'] : '';
  const currency = typeof money['currency'] === 'string' ? money['currency'] : 'BRL';
  const [text, setText] = useState(() => amountText(amount));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-medium">{label}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <TextField
          label={t('questions.amount')}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value);
            onChange({ amount: amountValue(event.currentTarget.value), currency });
          }}
        />
        <SelectField
          label={t('questions.currency')}
          value={currency}
          options={names.currencyOptions()}
          onChange={(chosen) => {
            onChange({ amount: amountValue(text), currency: chosen });
          }}
        />
      </div>
    </fieldset>
  );
}

/** The fields of one item, such as a citizenship or an asset. */
function ItemFields({
  fields,
  item,
  onChange,
  context,
}: {
  readonly fields: readonly QuestionField[];
  readonly item: Record_;
  readonly onChange: (item: Record_) => void;
  readonly context: QuestionContext;
}) {
  const names = useNames();
  return (
    <>
      {fields.map(({ key, input, optional }) => (
        <FieldEditor
          key={key}
          fieldKey={key}
          label={names.field(key)}
          input={input}
          value={item[key]}
          optional={optional}
          context={context}
          onChange={(next) => {
            // "Não sei" stays in the draft as null until the step is sent (`sentAnswer`).
            const rest = Object.fromEntries(
              Object.entries(item).filter(([field]) => field !== key),
            );
            onChange(next === undefined ? rest : { ...rest, [key]: next });
          }}
        />
      ))}
    </>
  );
}

type ListMode = 'has' | 'none' | 'unknown' | '';

function ListEditor({
  legend,
  hint,
  fields,
  value,
  canBeUnknown,
  onChange,
  context,
}: {
  readonly legend: string;
  readonly hint?: string;
  readonly fields: readonly QuestionField[];
  readonly value: unknown;
  readonly canBeUnknown: boolean;
  readonly onChange: (value: unknown) => void;
  readonly context: QuestionContext;
}) {
  const { t } = useTranslation();
  const items = Array.isArray(value) ? value.filter(isRecord) : [];
  const [mode, setMode] = useState<ListMode>(() =>
    value === null ? 'unknown' : !Array.isArray(value) ? '' : items.length === 0 ? 'none' : 'has',
  );
  return (
    <div className="flex flex-col gap-3">
      <ChoiceGroup
        legend={legend}
        {...(hint === undefined ? {} : { description: hint })}
        choices={[
          { value: listModes.has, label: t('questions.list.has') },
          { value: listModes.none, label: t('questions.list.none') },
          ...(canBeUnknown ? [{ value: listModes.unknown, label: t('questions.unknown') }] : []),
        ]}
        value={mode}
        onChange={(chosen) => {
          setMode(chosen);
          onChange(
            chosen === 'unknown' ? null : chosen === 'none' ? [] : items.length > 0 ? items : [{}],
          );
        }}
      />
      {mode === 'has' && (
        <ol className="flex flex-col gap-3">
          {items.map((item, index) => (
            // Items have no identity of their own until saved; the position is what the person sees.
            // eslint-disable-next-line @eslint-react/no-array-index-key
            <li key={index} className="flex flex-col gap-3 rounded-control border border-line p-3">
              <p className="font-medium">{t('questions.list.item', { number: index + 1 })}</p>
              <ItemFields
                fields={fields}
                item={item}
                context={context}
                onChange={(next) => {
                  onChange(items.map((entry, at) => (at === index ? next : entry)));
                }}
              />
              <button
                type="button"
                className={dangerLinkClass}
                onClick={() => {
                  onChange(items.filter((_, at) => at !== index));
                }}
              >
                {t('questions.list.remove')}
              </button>
            </li>
          ))}
          <li>
            <Button
              type="button"
              onClick={() => {
                onChange([...items, {}]);
              }}
            >
              {t('questions.list.add')}
            </Button>
          </li>
        </ol>
      )}
    </div>
  );
}

/** One question of the flow, by its input kind. */
export function QuestionEditor({
  input,
  legend,
  hint,
  value,
  related,
  canBeUnknown,
  onChange,
  context,
}: {
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
      return (
        <ChoiceGroup
          legend={legend}
          description={
            names.length === 0
              ? t('questions.relatedNone')
              : t('questions.related', {
                  names: new Intl.ListFormat(undefined, { type: 'conjunction' }).format(names),
                })
          }
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
          fieldKey=""
          label={legend}
          {...hinted}
          input={input}
          value={value}
          optional
          onChange={onChange}
          context={context}
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
  legend,
  hint,
  input,
  value,
  onChange,
  context,
}: {
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
      <legend className="font-medium">{legend}</legend>
      {hint !== undefined && <p className="-mt-1 text-small text-muted">{hint}</p>}
      {rows.length === 0 && <p className="text-muted">{t('questions.noRelationships')}</p>}
      {rows.map((row) => (
        <div
          key={String(row['id'])}
          className="flex flex-col gap-3 rounded-control border border-line p-3"
        >
          <p className="font-medium">{title(row)}</p>
          <ItemFields
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

/** The answer as the API takes it: a field left as "Não sei" inside an item is left out. */
export function sentAnswer(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item: unknown) =>
    isRecord(item)
      ? Object.fromEntries(Object.entries(item).filter(([, field]) => field !== null))
      : item,
  );
}
