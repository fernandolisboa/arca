import { Icon } from '@arca/ui';
import {
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';
import { CountryFlag } from '../country-flag.js';
import { matchesSearch } from './country-search.js';
import { selectClass, type SelectOption } from './select-field.js';

/** Options shown together, under a title when they are not the plain list of countries. */
export interface CountryOptionGroup {
  readonly title?: string;
  readonly options: readonly SelectOption[];
}

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

const optionClass =
  'flex min-h-touch w-full items-center gap-2 rounded-control border border-line px-3 py-2 text-left hover:bg-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary aria-pressed:border-primary aria-pressed:bg-soft aria-pressed:font-medium';

interface CountryPickerProps {
  /** Opens the picker with an empty search. */
  readonly ref: Ref<CountryPickerHandle>;
  /** Names the picker, and each untitled group of countries in it. */
  readonly label: string;
  /** The element that names the picker on the page, when one does. */
  readonly labelledBy?: string;
  readonly value: string;
  readonly onPick: (value: string) => void;
  readonly clearLabel?: string;
  readonly groups: readonly CountryOptionGroup[];
}

interface CountryPickerHandle {
  readonly open: () => void;
}

/**
 * The picker itself: a search box over the countries in a grid, each with its flag, which a native
 * select cannot draw. A modal dialog, so the browser keeps the focus inside, closes it on Escape
 * and gives the focus back to what opened it; a sheet from the bottom on a phone, a panel near the
 * top on wider screens.
 */
function CountryPicker({
  ref,
  label,
  labelledBy,
  value,
  onPick,
  clearLabel,
  groups,
}: CountryPickerProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  // The options exist only while the picker is open, so a page of closed pickers stays light.
  const [open, setOpen] = useState(false);
  useImperativeHandle(ref, () => ({
    open: () => {
      setSearch('');
      setOpen(true);
      dialogRef.current?.showModal();
    },
  }));
  const found = groups
    .map((group, position) => ({
      ...group,
      // Its place among the groups given, which a search never changes, as its key.
      id: String(position),
      options: group.options.filter((option) => matchesSearch(option.label, search)),
    }))
    .filter(({ options }) => options.length > 0);
  const [first] = found.flatMap(({ options }) => options);

  const pick = (picked: string) => {
    onPick(picked);
    dialogRef.current?.close();
  };
  const optionButtons = () => [
    ...(optionsRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []),
  ];
  // Arrows walk the options in reading order; up from the first one goes back to the search.
  const walk = (event: KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (step === undefined) return;
    const buttons = optionButtons();
    const next = buttons.indexOf(document.activeElement as HTMLButtonElement) + step;
    event.preventDefault();
    if (next < 0) searchRef.current?.focus();
    else buttons[next]?.focus();
  };

  return (
    <dialog
      ref={dialogRef}
      {...(labelledBy === undefined ? { 'aria-label': label } : { 'aria-labelledby': labelledBy })}
      className="fixed inset-x-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-none flex-col rounded-t-card border border-line bg-surface p-0 text-ink backdrop:bg-ink/40 open:flex sm:top-[10vh] sm:bottom-auto sm:mx-auto sm:max-h-[75vh] sm:w-[min(44rem,calc(100vw-2rem))] sm:rounded-card"
      onClick={(event) => {
        // A click on the dialog itself is one on its backdrop: the panel inside fills the box.
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
      onClose={() => {
        setOpen(false);
      }}
    >
      <div className="flex min-h-0 flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <input
            ref={searchRef}
            type="search"
            autoFocus
            aria-label={t('countryPicker.search')}
            placeholder={t('countryPicker.search')}
            value={search}
            className="min-h-touch min-w-0 flex-1 rounded-control border border-line bg-surface px-3 text-body text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onChange={(event) => {
              setSearch(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                optionButtons()[0]?.focus();
              }
              // Enter takes the first country found, and never submits a form around the field.
              if (event.key === 'Enter') {
                event.preventDefault();
                if (search.trim() !== '' && first !== undefined) pick(first.value);
              }
            }}
          />
          <button
            type="button"
            aria-label={t('countryPicker.close')}
            className="grid size-11 shrink-0 place-items-center rounded-control text-muted hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onClick={() => dialogRef.current?.close()}
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <div
          ref={optionsRef}
          role="presentation"
          className="-mx-1 flex min-h-0 flex-col gap-3 overflow-y-auto px-1 pb-1"
          onKeyDown={walk}
        >
          {open && (
            <>
              {(clearLabel !== undefined || value !== '') && search.trim() === '' && (
                <button
                  type="button"
                  aria-pressed={value === ''}
                  className={optionClass}
                  onClick={() => {
                    pick('');
                  }}
                >
                  {clearLabel ?? t('countryPicker.clear')}
                </button>
              )}
              {found.map((group) => (
                <div
                  key={group.id}
                  role="group"
                  aria-label={group.title ?? label}
                  className="flex flex-col gap-2"
                >
                  {group.title !== undefined && (
                    <p className="text-small font-medium text-muted">{group.title}</p>
                  )}
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                    {group.options.map((option) => (
                      <li key={option.value} className="flex">
                        <button
                          type="button"
                          aria-pressed={option.value === value}
                          className={optionClass}
                          onClick={() => {
                            pick(option.value);
                          }}
                        >
                          <CountryFlag code={option.value} />
                          <span className="min-w-0 flex-1 break-words">{option.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {found.length === 0 && <p className="text-muted">{t('countryPicker.none')}</p>}
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}

/** A country choice as a field that opens the picker and shows the country chosen. */
export function CountryField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  clearLabel,
  groups,
}: CountryFieldProps) {
  const id = useId();
  const labelId = useId();
  const valueId = useId();
  const hintId = useId();
  const pickerRef = useRef<CountryPickerHandle>(null);
  const chosen = groups.flatMap(({ options }) => options).find((option) => option.value === value);

  return (
    <div className="flex flex-col gap-1">
      <label id={labelId} htmlFor={id} className="font-medium">
        {label}
      </label>
      <button
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-describedby={hint === undefined ? undefined : hintId}
        className={`${selectClass} flex items-center gap-2 text-left`}
        onClick={() => pickerRef.current?.open()}
      >
        {chosen !== undefined && <CountryFlag code={chosen.value} />}
        <span id={valueId} className="min-w-0 flex-1 truncate">
          {chosen?.label ?? placeholder}
        </span>
        <span className="inline-flex shrink-0 rotate-90 text-muted">
          <Icon name="chevron" size={16} />
        </span>
      </button>
      {hint !== undefined && (
        <p id={hintId} className="text-small text-muted">
          {hint}
        </p>
      )}
      <CountryPicker
        ref={pickerRef}
        label={label}
        labelledBy={labelId}
        value={value}
        onPick={onChange}
        {...(clearLabel === undefined ? {} : { clearLabel })}
        groups={groups}
      />
    </div>
  );
}

/**
 * A button that opens the picker for one more country, where the countries already chosen show
 * elsewhere, such as a list a country is added to.
 */
export function CountryPickButton({
  label,
  className,
  disabled = false,
  groups,
  onPick,
  children,
}: {
  /** Names the picker; the button is named by what it holds. */
  readonly label: string;
  readonly className: string;
  readonly disabled?: boolean;
  readonly groups: readonly CountryOptionGroup[];
  readonly onPick: (value: string) => void;
  readonly children: ReactNode;
}) {
  const pickerRef = useRef<CountryPickerHandle>(null);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        disabled={disabled}
        className={className}
        onClick={() => pickerRef.current?.open()}
      >
        {children}
      </button>
      <CountryPicker ref={pickerRef} label={label} value="" onPick={onPick} groups={groups} />
    </>
  );
}
