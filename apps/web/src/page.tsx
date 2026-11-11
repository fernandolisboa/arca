import { useId, type ReactNode } from 'react';
import { pageIntroId } from './tour/tours.js';

/**
 * A page with its title and lead: a narrow centered column, as the account screens use, or the
 * shell's full width for screens that lay out lists and panels side by side.
 */
export function Page({
  title,
  lead,
  wide = false,
  children,
}: {
  readonly title: string;
  readonly lead?: string;
  readonly wide?: boolean;
  readonly children?: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={`flex flex-col gap-5 ${wide ? 'w-full' : 'mx-auto max-w-md'}`}
    >
      {/* A screen hint returns focus here when it closes, so the place is not lost. */}
      <div id={pageIntroId} tabIndex={-1} className="flex flex-col gap-2 outline-none">
        <h2 id={titleId} className="font-display text-title">
          {title}
        </h2>
        {lead !== undefined && <p className="max-w-prose text-muted">{lead}</p>}
      </div>
      {children}
    </section>
  );
}
