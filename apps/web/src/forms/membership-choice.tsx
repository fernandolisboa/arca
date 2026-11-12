import { useId } from 'react';
import { useTranslation } from 'react-i18next';

export type Membership = 'member' | 'relative';

/**
 * Whether a person is part of the plan or only a relative (spec 0007, R2): one switch, on for the
 * plan, with the hint saying what off means.
 */
export function MembershipChoice({
  value,
  onChange,
}: {
  readonly value: Membership;
  readonly onChange: (value: Membership) => void;
}) {
  const { t } = useTranslation();
  const hintId = useId();
  return (
    <label className="flex min-h-touch cursor-pointer items-center justify-between gap-4 rounded-control border border-line bg-surface px-3 py-2 hover:bg-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{t('family.membership.label')}</span>
        <span id={hintId} className="text-small text-muted">
          {t('family.membership.hint')}
        </span>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-describedby={hintId}
        checked={value === 'member'}
        onChange={(event) => {
          onChange(event.currentTarget.checked ? 'member' : 'relative');
        }}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="relative h-7 w-12 shrink-0 rounded-full bg-second transition-colors peer-checked:bg-primary after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full after:bg-surface after:shadow-card after:transition-transform peer-checked:after:translate-x-5 motion-reduce:transition-none motion-reduce:after:transition-none"
      />
    </label>
  );
}
