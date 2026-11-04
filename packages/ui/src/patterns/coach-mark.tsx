import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../button.js';

export interface CoachMarkLabels {
  readonly skip: string;
  readonly back: string;
  readonly next: string;
  readonly done: string;
}

export interface CoachMarkProps {
  /**
   * The ids of the element this step points at, in order of preference. The first one on screen is
   * used, since the shell renders some items once per layout and hides all but one with CSS. Focus
   * returns to it when the step ends.
   */
  readonly targetIds: readonly string[];
  readonly title: string;
  readonly body: string;
  /** "x de n". */
  readonly stepLabel: string;
  readonly first: boolean;
  readonly last: boolean;
  readonly labels: CoachMarkLabels;
  readonly onSkip: () => void;
  readonly onBack: () => void;
  /** Also called from Done on the last step. */
  readonly onNext: () => void;
}

interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** Space kept around the target and between it and the card, in px. */
const gap = 8;
const gutter = 16;

/** The first candidate on screen, or null when none is. */
function findTarget(ids: readonly string[]): HTMLElement | null {
  for (const id of ids) {
    const element = document.getElementById(id);
    // A hidden layout's copy has no box, so a zero size means it is not on screen.
    const rect = element?.getBoundingClientRect();
    if (element === null || rect === undefined) continue;
    if (rect.width > 0 && rect.height > 0) return element;
  }
  return null;
}

function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')];
}

function measure(target: HTMLElement): Box {
  const rect = target.getBoundingClientRect();
  return {
    top: rect.top - gap,
    left: rect.left - gap,
    width: rect.width + gap * 2,
    height: rect.height + gap * 2,
  };
}

/** Below the target when the card fits there, otherwise above, so it never covers the target. */
function cardPosition(spot: Box, card: { width: number; height: number }) {
  const below = spot.top + spot.height + gap;
  const top =
    below + card.height <= innerHeight - gutter
      ? below
      : Math.max(gutter, spot.top - gap - card.height);
  const left = Math.min(Math.max(gutter, spot.left), innerWidth - gutter - card.width);
  return { top, left: Math.max(gutter, left) };
}

/**
 * One step of the guided tour: a spotlight on the target that dims the rest with `bg` at 70%, and a
 * card beside it. Focus moves to the card and returns to the target; Escape skips the tour. The
 * spotlight glides between steps, and the motion axis turns that into a jump.
 */
export function CoachMark({
  targetIds,
  title,
  body,
  stepLabel,
  first,
  last,
  labels,
  onSkip,
  onBack,
  onNext,
}: CoachMarkProps) {
  const titleId = useId();
  const bodyId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<Box | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  const key = targetIds.join(' ');

  useLayoutEffect(() => {
    const ids = key.split(' ');
    let frame = 0;
    const update = () => {
      const target = findTarget(ids);
      const box = target === null ? null : measure(target);
      const card = cardRef.current;
      // eslint-disable-next-line @eslint-react/set-state-in-effect -- measured before paint, so no flash
      setSpot(box);
      setPlace(
        box === null || card === null ? null : cardPosition(box, card.getBoundingClientRect()),
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    findTarget(ids)?.scrollIntoView({ block: 'center' });
    update();
    // Font swaps, text size and reflow move the target without a resize or scroll event.
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    addEventListener('resize', schedule);
    addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      removeEventListener('resize', schedule);
      removeEventListener('scroll', schedule, true);
    };
  }, [key]);

  useEffect(() => {
    const ids = key.split(' ');
    cardRef.current?.focus();
    return () => {
      findTarget(ids)?.focus({ preventScroll: true });
    };
  }, [key]);

  useEffect(() => {
    // On the document, so Escape skips the tour wherever focus is, and nothing under it closes too.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onSkip();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onSkip]);

  return (
    <div className="fixed inset-0 z-40">
      {spot === null ? (
        <div className="absolute inset-0 bg-bg/70" />
      ) : (
        <div
          data-coach-spotlight
          className="absolute rounded-card shadow-[0_0_0_100vmax_color-mix(in_oklab,var(--arca-bg)_70%,transparent)] transition-[top,left,width,height] duration-(--arca-duration-slow) ease-out"
          style={spot}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        onKeyDown={(event) => {
          // Tab stays on the card's buttons, as the dimmed page behind it takes no pointer input.
          if (event.key !== 'Tab') return;
          const stops = focusables(event.currentTarget);
          const [firstStop] = stops;
          const lastStop = stops.at(-1);
          if (firstStop === undefined || lastStop === undefined) return;
          const active = document.activeElement;
          if (event.shiftKey && (active === firstStop || active === event.currentTarget)) {
            event.preventDefault();
            lastStop.focus();
          } else if (!event.shiftKey && active === lastStop) {
            event.preventDefault();
            firstStop.focus();
          }
        }}
        className="absolute bottom-4 left-4 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 rounded-card bg-surface p-4 shadow-lg ring-1 shadow-ink/15 ring-line focus-visible:outline-2 focus-visible:outline-primary"
        style={place === null ? undefined : { ...place, bottom: 'auto' }}
      >
        <p className="text-caption text-muted">{stepLabel}</p>
        <h2 id={titleId} className="font-display text-title">
          {title}
        </h2>
        <p id={bodyId}>{body}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="min-h-touch rounded-control px-3 font-medium text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {labels.skip}
          </button>
          <div className="flex gap-2">
            {!first && (
              <button
                type="button"
                onClick={onBack}
                className="min-h-touch rounded-control px-3 font-medium ring-1 ring-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {labels.back}
              </button>
            )}
            <Button onClick={onNext}>{last ? labels.done : labels.next}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
