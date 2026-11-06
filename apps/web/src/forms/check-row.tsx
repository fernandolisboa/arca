/** A checkbox as a full-width touch target, its label beside it. */
export function CheckRow({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-touch cursor-pointer items-center gap-3 rounded-control border border-line bg-surface px-3 py-2 hover:bg-soft has-checked:border-primary has-checked:bg-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
        className="size-4 shrink-0 accent-(--arca-primary)"
      />
      <span className="min-w-0 flex-1 break-words">{label}</span>
    </label>
  );
}
