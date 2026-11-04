import { axes, axisNames, type AxisName, type AxisValue } from '@arca/ui/theme/ids';

/**
 * Appearance preferences (spec 0006, R7): only the axes the person set, kept in localStorage under
 * one versioned key. Shared by the boot script and the app, so it imports the identifier lists
 * alone, never React or CSS.
 */
export const storageKey = 'arca.appearance';
const version = 1;

export type Preferences = { readonly [A in AxisName]?: AxisValue<A> };
export type ResolvedPreferences = { readonly [A in AxisName]: AxisValue<A> };

function isValue<A extends AxisName>(axis: A, value: unknown): value is AxisValue<A> {
  return typeof value === 'string' && (axes[axis].values as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What was stored, keeping only allow-listed values; anything else falls back to the defaults. */
export function parsePreferences(raw: string | null): Preferences {
  if (raw === null) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(data) || data['v'] !== version || !isRecord(data['axes'])) return {};
  const stored = data['axes'];
  const kept: Partial<Record<AxisName, string>> = {};
  for (const axis of axisNames) {
    const value = Object.hasOwn(stored, axis) ? stored[axis] : undefined;
    if (isValue(axis, value)) kept[axis] = value;
  }
  return kept as Preferences;
}

export function serializePreferences(preferences: Preferences): string {
  return JSON.stringify({ v: version, axes: preferences });
}

export function resolvePreferences(preferences: Preferences): ResolvedPreferences {
  return Object.fromEntries(
    axisNames.map((axis) => {
      const value = preferences[axis];
      return [axis, isValue(axis, value) ? value : axes[axis].default];
    }),
  ) as ResolvedPreferences;
}

interface AttributeTarget {
  setAttribute(name: string, value: string): void;
}

/** Sets the fixed `data-*` attribute of every axis on `<html>`, and nothing else. */
export function applyPreferences(root: AttributeTarget, preferences: Preferences): void {
  const resolved = resolvePreferences(preferences);
  for (const axis of axisNames) root.setAttribute(axes[axis].attribute, resolved[axis]);
}

/**
 * Points the `theme-color` meta tag at the background the stylesheet resolved, so `system` mode
 * follows the device without a copy of the palettes here.
 */
export function syncThemeColor(page: Document): void {
  const meta = page.querySelector('meta[name="theme-color"]');
  const background = getComputedStyle(page.documentElement).getPropertyValue('--arca-bg').trim();
  // Any hex form, since the CSS minifier may shorten a color.
  if (meta !== null && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(background)) {
    meta.setAttribute('content', background);
  }
}
