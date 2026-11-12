import { useRef, type KeyboardEvent } from 'react';

export interface Tab<V extends string> {
  readonly value: V;
  readonly label: string;
  /** A small number beside the label, such as how many people a section holds. */
  readonly count?: number;
}

export interface TabsProps<V extends string> {
  readonly label: string;
  readonly tabs: readonly Tab<V>[];
  /** The selected tab. */
  readonly value: V;
  readonly onChange: (value: V) => void;
  /** Ties each tab to its panel; pass the same base to `tabPanelProps`. */
  readonly idBase: string;
  /** Where the bar sits, such as a sticky position; the tabs' own look stays here. */
  readonly className?: string;
}

const tabId = (idBase: string, value: string) => `${idBase}-tab-${value}`;
const panelId = (idBase: string, value: string) => `${idBase}-panel-${value}`;

/** The attributes of the panel a tab shows. */
export function tabPanelProps(idBase: string, value: string) {
  return {
    id: panelId(idBase, value),
    role: 'tabpanel',
    'aria-labelledby': tabId(idBase, value),
    tabIndex: 0,
  } as const;
}

/**
 * Sections of one screen as the ARIA tabs pattern, for a screen that renders only the selected
 * panel (so only the selected tab names the panel it controls): arrow keys, Home and End move between tabs and
 * select them, and only the selected tab is in the Tab order. Chips that scroll sideways below
 * 768 px, an underlined row from 768 px.
 */
export function Tabs<V extends string>({
  label,
  tabs,
  value,
  onChange,
  idBase,
  className = '',
}: TabsProps<V>) {
  const listRef = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.value === value);
    const last = tabs.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined;
    const target = next === undefined ? undefined : tabs[next];
    if (target === undefined) return;
    event.preventDefault();
    onChange(target.value);
    listRef.current
      ?.querySelector<HTMLElement>(`#${CSS.escape(tabId(idBase, target.value))}`)
      ?.focus();
  };
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={move}
      className={`flex gap-1.5 overflow-x-auto [scrollbar-width:none] md:gap-6 md:border-b md:border-line ${className}`}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            id={tabId(idBase, tab.value)}
            type="button"
            role="tab"
            aria-selected={selected}
            {...(selected ? { 'aria-controls': panelId(idBase, tab.value) } : {})}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(tab.value);
            }}
            className={`inline-flex min-h-touch shrink-0 items-center gap-2 font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-md:rounded-full max-md:border max-md:px-3.5 md:-mb-px md:border-b-2 md:px-0.5 ${
              selected
                ? 'max-md:border-primary max-md:bg-primary max-md:text-on-primary md:border-accent md:text-ink'
                : 'text-muted hover:text-ink max-md:border-line max-md:bg-surface md:border-transparent'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={`rounded-full px-2 text-caption ${selected ? 'max-md:bg-on-primary/20 md:bg-soft' : 'bg-soft'}`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
