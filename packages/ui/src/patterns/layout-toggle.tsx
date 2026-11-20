import { iconButtonClass } from '../button.js';
import { Icon, type IconName } from '../icon.js';

export interface LayoutOption<V extends string> {
  readonly value: V;
  readonly label: string;
  readonly icon: IconName;
}

export interface LayoutToggleProps<V extends string> {
  readonly label: string;
  readonly options: readonly LayoutOption<V>[];
  readonly value: V;
  readonly onChange: (value: V) => void;
  readonly className?: string;
}

/** Icon buttons that switch how a page lays out the same items, the chosen one pressed. */
export function LayoutToggle<V extends string>({
  label,
  options,
  value,
  onChange,
  className = '',
}: LayoutToggleProps<V>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex shrink-0 gap-0.5 rounded-control border border-line bg-surface p-0.5 ${className}`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          aria-label={option.label}
          title={option.label}
          className={`${iconButtonClass} ${value === option.value ? 'bg-soft text-ink' : 'text-muted hover:text-ink'}`}
          onClick={() => {
            onChange(option.value);
          }}
        >
          <Icon name={option.icon} />
        </button>
      ))}
    </div>
  );
}
