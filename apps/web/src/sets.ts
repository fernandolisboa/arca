/** The set with `item` added, or removed when `on` is false. */
export function toggled(set: ReadonlySet<string>, item: string, on: boolean): Set<string> {
  const next = new Set(set);
  if (on) next.add(item);
  else next.delete(item);
  return next;
}
