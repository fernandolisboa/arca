import { useId, type ReactNode } from 'react';
import { pageIntroId } from './tour/tours.js';

/**
 * A page with its title and lead, across the shell's full width so a wide screen lays panels side
 * by side. `narrow` keeps a centered column, for short forms such as signing in.
 */
export function Page({
  title,
  lead,
  narrow = false,
  actions,
  children,
}: {
  readonly title: string;
  readonly lead?: string;
  readonly narrow?: boolean;
  /** Controls for the whole screen, at the top right beside the title. */
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
}) {
  const titleId = useId();
  // A screen hint returns focus here when it closes, so the place is not lost.
  const intro = (
    <div id={pageIntroId} tabIndex={-1} className="flex flex-col gap-2 outline-none">
      <h2 id={titleId} className="font-display text-title">
        {title}
      </h2>
      {lead !== undefined && <p className="max-w-prose text-muted">{lead}</p>}
    </div>
  );
  return (
    <section
      aria-labelledby={titleId}
      className={`flex flex-col gap-5 ${narrow ? 'mx-auto max-w-md' : 'w-full'}`}
    >
      {actions === undefined ? (
        intro
      ) : (
        <div className="flex items-start justify-between gap-3">
          {intro}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A page's content beside a side column on a wide screen: the side holds the actions and forms,
 * the main column what they act on. The side comes first in reading order, so a phone shows it
 * on top.
 */
/** The grid of a main column beside a side column on a wide screen. */
export const pageColumnsClass = 'lg:grid-cols-[minmax(0,1fr)_22rem]';

export function PageColumns({
  side,
  children,
}: {
  readonly side: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className={`grid items-start gap-6 lg:gap-8 ${pageColumnsClass}`}>
      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:col-start-2 lg:row-start-1">
        {side}
      </div>
      <div className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-1">{children}</div>
    </div>
  );
}
