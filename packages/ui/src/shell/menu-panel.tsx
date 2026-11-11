import { useEffect, useRef, type RefObject } from 'react';
import { Icon } from '../icon.js';
import { NavList, type NavItem, type ShellLink } from './nav.js';

export interface MenuGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly NavItem[];
}

export interface SignOut {
  readonly label: string;
  readonly onSelect: () => void;
}

interface MenuPanelProps {
  readonly id: string;
  readonly groups: readonly MenuGroup[];
  readonly signOut?: SignOut;
  readonly link: ShellLink;
  /** The menu button that opened the panel: part of the focus trap, and where focus returns. */
  readonly toggle: RefObject<HTMLButtonElement | null>;
  /** Escape, the backdrop and the menu button close the panel and return focus to the button. */
  readonly onClose: () => void;
  /** Following a link closes the panel and leaves focus to the new page. */
  readonly onNavigate: () => void;
}

const focusable = 'a[href], button:not([disabled])';

/**
 * The open menu (spec 0006, Navigation): a full-width sheet on phones, a 340 px panel from the top
 * right above 768 px. Focus is trapped across the menu button and the panel; Escape closes it.
 */
export function MenuPanel({
  id,
  groups,
  signOut,
  link,
  toggle,
  onClose,
  onNavigate,
}: MenuPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>(focusable)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || panelRef.current === null || toggle.current === null) return;
      const stops = [toggle.current, ...panelRef.current.querySelectorAll<HTMLElement>(focusable)];
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? at <= 0
          ? stops.length - 1
          : at - 1
        : at === -1 || at === stops.length - 1
          ? 0
          : at + 1;
      event.preventDefault();
      stops[next]?.focus();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, toggle]);

  return (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-30 bg-bg/70" onClick={onClose} />
      <div
        id={id}
        ref={panelRef}
        className="fixed inset-x-0 top-[calc(var(--spacing-bar)+env(safe-area-inset-top))] bottom-0 z-30 overflow-y-auto border-t border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:inset-x-auto md:right-4 md:bottom-auto md:max-h-[calc(100dvh-5rem)] md:w-[340px] md:rounded-card md:border md:shadow-lg md:shadow-ink/15"
      >
        {groups.map((group) => (
          <section key={group.id} aria-labelledby={`${id}-${group.id}`} className="mb-4">
            <h2
              id={`${id}-${group.id}`}
              className="mb-1 px-3 text-caption font-medium tracking-wide text-muted uppercase"
            >
              {group.label}
            </h2>
            <NavList
              items={group.items}
              link={link}
              place="menu"
              shape="row"
              direction="column"
              onNavigate={onNavigate}
            />
          </section>
        ))}
        {signOut !== undefined && (
          <button
            type="button"
            onClick={signOut.onSelect}
            className="flex min-h-touch w-full items-center gap-3 rounded-control border-t border-line px-3 text-danger-ink hover:bg-danger-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Icon name="signOut" />
            {signOut.label}
          </button>
        )}
      </div>
    </>
  );
}
