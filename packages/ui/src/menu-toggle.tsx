export interface MenuToggleProps {
  readonly open: boolean;
  readonly onToggle: () => void;
  /** The id of the panel this button opens. */
  readonly controls: string;
  /** "Abrir menu" and "Fechar menu", from the app's messages. */
  readonly openLabel: string;
  readonly closeLabel: string;
}

const line =
  'absolute left-0 h-0.5 w-full rounded-full bg-current transition-[translate,rotate,opacity] duration-(--arca-duration-base) ease-out';

/**
 * The menu button (spec 0006, Navigation): three lines that morph into an X while the panel is
 * open, so the same button closes it. The top and bottom lines rotate 45° to meet; the middle fades.
 */
export function MenuToggle({ open, onToggle, controls, openLabel, closeLabel }: MenuToggleProps) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={open ? closeLabel : openLabel}
      onClick={onToggle}
      className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-control text-ink hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <span aria-hidden="true" className="relative block h-3.5 w-5">
        <span
          data-line="top"
          className={`${line} top-0 ${open ? 'translate-y-1.5 rotate-45' : ''}`}
        />
        <span data-line="middle" className={`${line} top-1.5 ${open ? 'opacity-0' : ''}`} />
        <span
          data-line="bottom"
          className={`${line} top-3 ${open ? '-translate-y-1.5 -rotate-45' : ''}`}
        />
      </span>
    </button>
  );
}
