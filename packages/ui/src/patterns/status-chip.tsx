export type StatusTone = 'ok' | 'warn' | 'danger' | 'unknown';

export interface StatusChipProps {
  readonly tone: StatusTone;
  /** The status in CONTEXT.md terms, such as "Versão ativa". */
  readonly label: string;
}

const tones: Record<StatusTone, string> = {
  ok: 'bg-ok-bg text-ok-ink',
  warn: 'bg-warn-bg text-warn-ink',
  danger: 'bg-danger-bg text-danger-ink',
  unknown: 'bg-soft text-muted',
};

/** A rule version's status: active (`ok`), pending activation (`warn`) or unknown. */
export function StatusChip({ tone, label }: StatusChipProps) {
  return (
    <span
      data-tone={tone}
      className={`inline-flex items-center rounded-chip px-2 py-0.5 text-caption font-medium whitespace-nowrap ${tones[tone]}`}
    >
      {label}
    </span>
  );
}
