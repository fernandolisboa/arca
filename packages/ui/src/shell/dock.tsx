import { useRef, useState, type PointerEvent } from 'react';
import { NavList, type DockEdge, type NavItem, type ShellLink } from './nav.js';

export type DockKind = 'fixed' | 'floating';

const placement = {
  fixed:
    'inset-x-0 bottom-0 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]',
  bottom:
    'inset-x-3.5 bottom-[calc(14px+env(safe-area-inset-bottom))] md:inset-x-auto md:left-1/2 md:-translate-x-1/2',
  left: 'top-1/2 left-[calc(14px+env(safe-area-inset-left))] w-20 -translate-y-1/2',
  right: 'top-1/2 right-[calc(14px+env(safe-area-inset-right))] w-20 -translate-y-1/2',
} as const;

/** How far, in px, the pointer moves before a press on the grip becomes a drag. */
const dragThreshold = 10;

/** Snaps a drop point to the nearest of the three edges a floating dock may use. */
export function nearestEdge(x: number, y: number, width: number, height: number): DockEdge {
  const distances: readonly (readonly [DockEdge, number])[] = [
    ['bottom', height - y],
    ['left', x],
    ['right', width - x],
  ];
  return distances.reduce((nearest, entry) => (entry[1] < nearest[1] ? entry : nearest))[0];
}

interface DockProps {
  readonly kind: DockKind;
  readonly edge: DockEdge;
  readonly label: string;
  readonly items: readonly NavItem[];
  readonly link: ShellLink;
  readonly className: string;
  readonly inert: boolean;
  /** Present when the person may drag the floating dock to another edge. */
  readonly onEdgeChange?: (edge: DockEdge) => void;
}

/**
 * The fixed dock on the bottom edge, or the floating dock on any edge. Dragging the floating dock
 * by its grip snaps it to the nearest edge; Settings offers the same choice without a pointer.
 */
export function Dock({
  kind,
  edge,
  label,
  items,
  link,
  className,
  inert,
  onEdgeChange,
}: DockProps) {
  const vertical = kind === 'floating' && edge !== 'bottom';
  const startRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);

  function onPointerDown(event: PointerEvent<HTMLSpanElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = { x: event.clientX, y: event.clientY, moved: false };
  }

  function onPointerMove(event: PointerEvent<HTMLSpanElement>) {
    const start = startRef.current;
    if (start === null) return;
    const x = event.clientX - start.x;
    const y = event.clientY - start.y;
    // A tap is not a drag: the dock follows the pointer only once it has moved past the threshold.
    if (!start.moved && Math.hypot(x, y) < dragThreshold) return;
    start.moved = true;
    setOffset({ x, y });
  }

  function onPointerEnd(event: PointerEvent<HTMLSpanElement>) {
    const start = startRef.current;
    if (start === null) return;
    startRef.current = null;
    setOffset(null);
    if (event.type !== 'pointerup' || !start.moved) return;
    const next = nearestEdge(event.clientX, event.clientY, window.innerWidth, window.innerHeight);
    if (next !== edge) onEdgeChange?.(next);
  }

  const shape =
    kind === 'fixed'
      ? // A shadow line instead of a border, so the dock is exactly the height content clears.
        'bg-surface shadow-[0_-1px_0_0_var(--arca-line)]'
      : 'rounded-dock bg-surface p-1 shadow-lg ring-1 shadow-ink/15 ring-line';
  return (
    <nav
      aria-label={label}
      inert={inert}
      data-dock={kind}
      data-edge={kind === 'fixed' ? 'bottom' : edge}
      className={`fixed z-20 flex ${vertical ? 'flex-col' : 'flex-row'} items-stretch ${shape} ${placement[kind === 'fixed' ? 'fixed' : edge]} ${className}`}
      {...(offset === null
        ? {}
        : { style: { transform: `translate(${String(offset.x)}px, ${String(offset.y)}px)` } })}
    >
      {kind === 'floating' && onEdgeChange !== undefined && (
        <span
          aria-hidden="true"
          data-dock-grip=""
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          className={`flex shrink-0 touch-none cursor-grab items-center justify-center active:cursor-grabbing ${vertical ? 'h-5' : 'w-5'}`}
        >
          <span className={`rounded-full bg-line ${vertical ? 'h-1 w-8' : 'h-8 w-1'}`} />
        </span>
      )}
      <div className={`min-w-0 flex-1 ${kind === 'fixed' ? 'p-1' : ''}`}>
        <NavList items={items} link={link} shape="cell" direction={vertical ? 'column' : 'row'} />
      </div>
    </nav>
  );
}
