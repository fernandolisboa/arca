import { type ReactNode, useId, useState } from 'react';
import { Icon, type IconName } from '../icon.js';

interface DisclosureBase {
  /** The heading, which is also the toggle's name and the region's name. */
  readonly title: string;
  readonly level: 4 | 5;
  readonly icon?: IconName;
  /** Shown beside the title whether open or closed, such as a status chip. */
  readonly aside?: ReactNode;
  /** Shown under the body whether open or closed, such as a note that a model wrote it. */
  readonly footer?: ReactNode;
  /** The surface classes of the whole region. */
  readonly className: string;
  readonly children: ReactNode;
}

/** The disclosure keeps its own state, or its parent does, such as across a remount. */
export type DisclosureProps = DisclosureBase &
  (
    | {
        /** Read once, when the disclosure first renders; a different `key` starts it over. */
        readonly defaultOpen: boolean;
        readonly open?: never;
        readonly onOpenChange?: never;
      }
    | {
        readonly defaultOpen?: never;
        readonly open: boolean;
        readonly onOpenChange: (open: boolean) => void;
      }
  );

/**
 * A titled region whose body folds away behind its heading (the WAI-ARIA disclosure pattern): the
 * heading holds a button that says whether the body is open, so the heading still shows up in a
 * screen reader's list of headings.
 */
export function Disclosure({
  title,
  level,
  icon,
  aside,
  defaultOpen,
  open: controlled,
  onOpenChange,
  footer,
  className,
  children,
}: DisclosureProps) {
  const [own, setOwn] = useState(defaultOpen ?? false);
  const open = controlled ?? own;
  const titleId = useId();
  const bodyId = useId();
  const Heading = level === 4 ? 'h4' : 'h5';
  return (
    <section aria-labelledby={titleId} className={className}>
      <div className="flex flex-wrap items-center gap-x-3">
        <Heading className="min-w-0 flex-1 font-medium">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => {
              setOwn(!open);
              onOpenChange?.(!open);
            }}
            className="flex min-h-touch w-full items-center gap-2 rounded-control text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {icon !== undefined && <Icon name={icon} size={18} />}
            <span id={titleId} className="min-w-0 flex-1">
              {title}
            </span>
            <span
              data-open={open || undefined}
              className="inline-flex shrink-0 text-muted transition-transform duration-(--arca-duration-base) ease-out data-open:rotate-90"
            >
              <Icon name="chevron" size={18} />
            </span>
          </button>
        </Heading>
        {aside}
      </div>
      <div id={bodyId} hidden={!open} className="flex flex-col gap-2">
        {children}
      </div>
      {footer}
    </section>
  );
}
