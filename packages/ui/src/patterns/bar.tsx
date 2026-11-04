/** Rows after this one start growing together with it. */
const lastStaggeredRow = 5;

/** Literal classes, so Tailwind generates them: row n waits n stagger steps. */
const delays = [
  '[animation-delay:0ms]',
  '[animation-delay:var(--arca-stagger-step)]',
  '[animation-delay:calc(var(--arca-stagger-step)*2)]',
  '[animation-delay:calc(var(--arca-stagger-step)*3)]',
  '[animation-delay:calc(var(--arca-stagger-step)*4)]',
  '[animation-delay:calc(var(--arca-stagger-step)*5)]',
] as const;

export interface BarProps {
  readonly ratio: number;
  readonly lead?: boolean;
  /** The row's place in a list, counted from 0, for the staggered growth on first paint. */
  readonly row?: number;
}

/**
 * A rounded bar on `track` with a fill that grows from zero on first paint. SVG lengths carry the
 * width, so no inline style is needed. The caller labels the value in text; the bar is hidden.
 */
export function Bar({ ratio, lead = true, row = 0 }: BarProps) {
  const percent = `${String(Math.round(Math.min(Math.max(ratio, 0), 1) * 1000) / 10)}%`;
  const delay = delays[Math.min(Math.max(Math.trunc(row), 0), lastStaggeredRow)] ?? delays[0];
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="block h-2 w-full overflow-hidden rounded-full"
    >
      <rect width="100%" height="100%" className="fill-track" />
      <rect
        width={percent}
        height="100%"
        className={`origin-left animate-bar-grow [transform-box:fill-box] ${delay} ${lead ? 'fill-primary' : 'fill-second'}`}
      />
    </svg>
  );
}
