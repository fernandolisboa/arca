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

/** The tab a key moves to, wrapping at both ends; undefined for a key the tabs do not use. */
export function nextTabIndex(key: string, index: number, count: number): number | undefined {
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}

/** A bar a page keeps at the bottom of a phone screen, right above the shell's dock. */
export const phoneBottomBarClass =
  'max-md:sticky max-md:bottom-[var(--shell-bottom,0px)] max-md:z-10';

/**
 * The ARIA tabs pattern for a screen that renders only the selected panel: arrow keys, Home and
 * End select, and only the selected tab is a Tab stop. Chips below 768 px, an underlined row above.
 */
export function Tabs<V extends string>({
  label,
  tabs,
  value,
  onChange,
  idBase,
  className = '',
}: TabsProps<V>) {
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTabIndex(
      event.key,
      tabs.findIndex((tab) => tab.value === value),
      tabs.length,
    );
    const target = next === undefined ? undefined : tabs[next];
    if (target === undefined) return;
    event.preventDefault();
    onChange(target.value);
    buttonsRef.current.get(target.value)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={move}
      className={`flex gap-1.5 overflow-x-auto [scrollbar-width:none] max-md:pr-8 max-md:[mask-image:linear-gradient(to_right,#000_calc(100%-2rem),transparent)] md:gap-6 md:border-b md:border-line ${className}`}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(button) => {
              if (button === null) buttonsRef.current.delete(tab.value);
              else buttonsRef.current.set(tab.value, button);
            }}
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
