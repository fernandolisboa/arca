import { Disclosure, cardClass } from '@arca/ui';
import { type ReactNode, createContext, use, useMemo, useState } from 'react';

/** Which foldable cards of the activation screen are open, kept while a version is open. */
export interface Folds {
  /** Whether a card is open: what the admin last chose for it, or for all, else `fallback`. */
  readonly isOpen: (key: string, fallback: boolean) => boolean;
  readonly set: (key: string, open: boolean) => void;
  /** Opens or folds every card, on screen now or later, until one is toggled again. */
  readonly setAll: (open: boolean) => void;
}

export function useFolds(): Folds {
  const [state, setState] = useState<{
    readonly all: boolean | null;
    readonly keys: ReadonlyMap<string, boolean>;
  }>(() => ({ all: null, keys: new Map() }));
  return useMemo(
    () => ({
      isOpen: (key, fallback) => state.keys.get(key) ?? state.all ?? fallback,
      set: (key, open) => {
        setState((was) => ({ ...was, keys: new Map(was.keys).set(key, open) }));
      },
      setAll: (open) => {
        setState({ all: open, keys: new Map() });
      },
    }),
    [state],
  );
}

export const FoldsContext = createContext<Folds | null>(null);

function useFoldsContext(): Folds {
  const folds = use(FoldsContext);
  if (folds === null) throw new Error('Fold needs a FoldsContext');
  return folds;
}

/** The surface of a foldable card in a masonry of columns: it never splits across two. */
export const foldCardClass = 'mb-3 break-inside-avoid';

/**
 * A card that folds behind its title, keyed in the screen's folds. Folded, it shows `summary`
 * under the title, so the card still says what it holds.
 */
export function Fold({
  id,
  fallback,
  title,
  lead,
  count,
  summary,
  level = 4,
  className,
  children,
}: {
  readonly id: string;
  /** Open or folded until the admin chooses. */
  readonly fallback: boolean;
  readonly title: string;
  readonly lead?: ReactNode;
  /** A small number beside the title. */
  readonly count?: number | undefined;
  readonly summary: string;
  readonly level?: 4 | 5;
  readonly className: string;
  readonly children: ReactNode;
}) {
  const folds = useFoldsContext();
  const open = folds.isOpen(id, fallback);
  return (
    <Disclosure
      title={title}
      lead={lead}
      level={level}
      open={open}
      onOpenChange={(next) => {
        folds.set(id, next);
      }}
      badge={
        count !== undefined && (
          <span className="rounded-full bg-soft px-2 text-caption tabular-nums">{count}</span>
        )
      }
      aside={!open && <p className="basis-full pb-3 text-small text-muted">{summary}</p>}
      className={className}
    >
      {children}
    </Disclosure>
  );
}

/** One block of requests and reports as a foldable card, open until the admin folds it. */
export function RequestFold({
  id,
  title,
  count,
  summary,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly count?: number | undefined;
  readonly summary: string;
  readonly children: ReactNode;
}) {
  return (
    <Fold
      id={`requests:${id}`}
      fallback
      title={title}
      count={count}
      summary={summary}
      className={`px-4 ${cardClass} ${foldCardClass}`}
    >
      <div className="flex flex-col gap-3 pb-4">{children}</div>
    </Fold>
  );
}
