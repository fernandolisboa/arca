import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Icon } from '../icon.js';
import { fieldControlClass, matchesSearch } from './field.js';

export interface SearchPickerOption {
  readonly value: string;
  readonly label: string;
}

/** Options shown together, under a title when they are not the plain list. */
export interface SearchPickerGroup {
  readonly title?: string;
  readonly options: readonly SearchPickerOption[];
}

export interface SearchPickerLabels {
  /** The search box's name and placeholder. */
  readonly search: string;
  /** Shown when nothing answers the search. */
  readonly none: string;
  /** The option that clears the choice, when no `clearLabel` names it. */
  readonly clear: string;
  readonly close: string;
}

export interface SearchPickerProps {
  readonly label: string;
  readonly hint?: string;
  /** The chosen option's value, or an empty string while nothing is chosen. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Shown in the field while nothing is chosen. */
  readonly placeholder: string;
  /**
   * The name of the picker's first option, which clears the choice, such as "all countries".
   * Without it, that option shows only while something is chosen, under `labels.clear`.
   */
  readonly clearLabel?: string;
  readonly groups: readonly SearchPickerGroup[];
  readonly labels: SearchPickerLabels;
  /** Whether an option's label answers the search; by default, ignoring accents and case. */
  readonly matches?: (label: string, search: string) => boolean;
  /** Drawn before an option's label, in the field and in the picker, such as a flag. */
  readonly lead?: (value: string) => ReactNode;
  /** Short labels in a grid of tiles, or long ones in a list of one or two columns. */
  readonly layout?: 'grid' | 'list';
}

const optionClass =
  'flex min-h-touch w-full items-center gap-2 rounded-control border border-line px-3 py-2 text-left hover:bg-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary aria-pressed:border-primary aria-pressed:bg-soft aria-pressed:font-medium';

const layoutClass = {
  grid: {
    options: 'grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4',
    panel: 'sm:w-[min(44rem,calc(100vw-2rem))]',
  },
  list: {
    options: 'grid grid-cols-1 gap-2 md:grid-cols-2',
    panel: 'sm:w-[min(60rem,calc(100vw-2rem))]',
  },
} as const;

/**
 * The groups with only the options that answer the search, each keyed by its place among the
 * groups given, which a search never changes; groups left empty are dropped.
 */
export function foundGroups(
  groups: readonly SearchPickerGroup[],
  search: string,
  matches: (label: string, search: string) => boolean = matchesSearch,
): (SearchPickerGroup & { readonly id: string })[] {
  return groups
    .map((group, position) => ({
      ...group,
      id: String(position),
      options: group.options.filter((option) => matches(option.label, search)),
    }))
    .filter(({ options }) => options.length > 0);
}

type PickerOptions = Pick<
  SearchPickerProps,
  'value' | 'clearLabel' | 'groups' | 'labels' | 'matches' | 'lead' | 'layout'
>;

interface PickerHandle {
  /** Opens the picker with an empty search. */
  readonly open: () => void;
}

interface PickerDialogProps extends PickerOptions {
  readonly ref: Ref<PickerHandle>;
  /** Names each untitled group, and the picker when no element on the page does. */
  readonly label: string;
  /** The element that names the picker on the page, when one does. */
  readonly labelledBy?: string;
  readonly onPick: (value: string) => void;
  /** Builds the options only while the picker is open, for a page that holds many pickers. */
  readonly lazy?: boolean;
}

/**
 * The picker itself: a search box over the options. A modal dialog, so the browser keeps the focus
 * inside, closes it on Escape and gives the focus back to what opened it; a sheet from the bottom
 * on a phone, a panel near the top on wider screens. Arrows walk the options in reading order, and
 * Enter in the search takes the first option found.
 */
function PickerDialog({
  ref,
  label,
  labelledBy,
  value,
  onPick,
  clearLabel,
  groups,
  labels,
  matches = matchesSearch,
  lead,
  layout = 'grid',
  lazy = false,
}: PickerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  useImperativeHandle(ref, () => ({
    open: () => {
      setSearch('');
      setOpen(true);
      dialogRef.current?.showModal();
    },
  }));
  const found = foundGroups(groups, search, matches);
  const [first] = found.flatMap(({ options }) => options);

  const pick = (picked: string) => {
    onPick(picked);
    dialogRef.current?.close();
  };
  const optionButtons = () => [
    ...(optionsRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []),
  ];
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
      className={`fixed inset-x-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-none flex-col rounded-t-card border border-line bg-surface p-0 text-ink backdrop:bg-ink/40 open:flex sm:top-[10vh] sm:bottom-auto sm:mx-auto sm:max-h-[75vh] sm:rounded-card ${layoutClass[layout].panel}`}
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
            aria-label={labels.search}
            placeholder={labels.search}
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
              // Enter never submits a form around the field.
              if (event.key === 'Enter') {
                event.preventDefault();
                if (search.trim() !== '' && first !== undefined) pick(first.value);
              }
            }}
          />
          <button
            type="button"
            aria-label={labels.close}
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
          {(open || !lazy) && (
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
                  {clearLabel ?? labels.clear}
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
                  <ul className={layoutClass[layout].options}>
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
                          {lead?.(option.value)}
                          <span className="min-w-0 flex-1 break-words">{option.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {found.length === 0 && <p className="text-muted">{labels.none}</p>}
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}

/**
 * A choice among many options as a field that opens a picker: a search box over the options, which
 * a native select cannot offer.
 */
export function SearchPicker({
  label,
  hint,
  value,
  onChange,
  placeholder,
  groups,
  lead,
  ...options
}: SearchPickerProps) {
  const id = useId();
  const labelId = useId();
  const valueId = useId();
  const hintId = useId();
  const pickerRef = useRef<PickerHandle>(null);
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
        className={`${fieldControlClass} flex items-center gap-2 text-left`}
        onClick={() => pickerRef.current?.open()}
      >
        {chosen !== undefined && lead?.(chosen.value)}
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
      <PickerDialog
        ref={pickerRef}
        label={label}
        labelledBy={labelId}
        value={value}
        onPick={onChange}
        groups={groups}
        {...(lead === undefined ? {} : { lead })}
        {...options}
      />
    </div>
  );
}

export interface SearchPickButtonProps extends Omit<PickerOptions, 'value' | 'clearLabel'> {
  /** Names the picker; the button is named by what it holds. */
  readonly label: string;
  readonly className: string;
  readonly disabled?: boolean;
  readonly onPick: (value: string) => void;
  readonly children: ReactNode;
}

/**
 * A button that opens the picker to add one more option, where those already chosen show
 * elsewhere, such as a list an option is added to. Its options are built only while it is open,
 * so a page can hold one per row.
 */
export function SearchPickButton({
  label,
  className,
  disabled = false,
  onPick,
  children,
  ...options
}: SearchPickButtonProps) {
  const pickerRef = useRef<PickerHandle>(null);
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
      <PickerDialog ref={pickerRef} label={label} value="" onPick={onPick} lazy {...options} />
    </>
  );
}
