import { useId, type ReactNode } from 'react';

/** A single-column page with its title and lead, as the account screens use. */
export function Page({
  title,
  lead,
  children,
}: {
  readonly title: string;
  readonly lead?: string;
  readonly children?: ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="mx-auto flex max-w-md flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id={titleId} className="font-display text-title">
          {title}
        </h2>
        {lead !== undefined && <p className="text-muted">{lead}</p>}
      </div>
      {children}
    </section>
  );
}
