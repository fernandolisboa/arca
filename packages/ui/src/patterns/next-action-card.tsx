import { useId } from 'react';

export interface NextActionCardProps {
  readonly from: string;
  readonly to: string;
  /** Read out in place of the drawn route, such as "De Curitiba para Lisboa". */
  readonly routeLabel: string;
  readonly title: string;
  /** One line: where, how long and what it needs. */
  readonly details: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
}

/** The one concrete next step, on `primary`, with the route from origin to destination. */
export function NextActionCard({
  from,
  to,
  routeLabel,
  title,
  details,
  actionLabel,
  onAction,
}: NextActionCardProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-card bg-primary p-5 text-on-primary"
    >
      <p className="sr-only">{routeLabel}</p>
      <div aria-hidden="true" className="flex items-center gap-3 text-small">
        <span>{from}</span>
        <span className="relative h-0.5 flex-1 rounded-full bg-on-primary/40">
          <span className="absolute -top-[3px] left-0 size-2 animate-route-dot rounded-full bg-on-primary" />
        </span>
        <span>{to}</span>
      </div>
      <h2 id={titleId} className="font-display text-title">
        {title}
      </h2>
      <p className="opacity-90">{details}</p>
      <button
        type="button"
        onClick={onAction}
        className="inline-flex min-h-touch items-center justify-center self-start rounded-control bg-on-primary px-4 font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-primary"
      >
        {actionLabel}
      </button>
    </section>
  );
}
