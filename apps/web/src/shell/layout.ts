import { axes, type AxisValue } from '@arca/ui/theme/ids';
import type { ShellLayout } from '@arca/ui';

function allowed<A extends 'navWide' | 'navNarrow' | 'dockEdge'>(
  name: A,
  root: Element,
): AxisValue<A> {
  const { attribute, values, default: fallback } = axes[name];
  const value = root.getAttribute(attribute);
  return (values as readonly string[]).includes(value ?? '') ? (value as AxisValue<A>) : fallback;
}

/**
 * The navigation layout from the attributes on `<html>`, allow-listed, with the defaults for
 * anything missing or unknown. The appearance preferences (spec 0006, R7) set these attributes.
 */
export function layoutFromDocument(root: Element = document.documentElement): ShellLayout {
  return {
    wide: allowed('navWide', root),
    narrow: allowed('navNarrow', root),
    dockEdge: allowed('dockEdge', root),
  };
}
