import type { DeviceDescription } from '@arca/api-contract/routes';

/**
 * The device a session runs on, as two closed enums derived on the server from the user agent
 * (spec 0003, R4). The raw user agent is never stored; clients render these through i18n.
 */
type BrowserFamily = DeviceDescription['browser'];
type OsFamily = DeviceDescription['os'];

// First match wins, so engines that also announce Chrome or Safari come before them.
const browserRules: readonly (readonly [BrowserFamily, RegExp])[] = [
  ['edge', /\bEdg(?:e|A|iOS)?\//],
  ['samsung_internet', /\bSamsungBrowser\//],
  ['opera', /\b(?:OPR|OPT|Opera)\//],
  ['firefox', /\b(?:Firefox|FxiOS)\//],
  ['chrome', /\b(?:Chrome|CriOS|Chromium)\//],
  ['safari', /\bVersion\/[\d.]+.*\bSafari\//],
];

const osRules: readonly (readonly [OsFamily, RegExp])[] = [
  ['ipados', /\biPad\b/],
  ['ios', /\b(?:iPhone|iPod)\b/],
  ['android', /\bAndroid\b/],
  ['chromeos', /\bCrOS\b/],
  ['windows', /\bWindows\b/],
  ['macos', /\bMac OS X\b/],
  ['linux', /\bLinux\b/],
];

/** Longer strings are not user agents a browser sends, and are not worth matching. */
const maximumLength = 512;

function firstMatch<Family extends string>(
  rules: readonly (readonly [Family, RegExp])[],
  userAgent: string,
): Family | 'other' {
  return rules.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? 'other';
}

export function describeDevice(userAgent: string | null | undefined): DeviceDescription {
  if (typeof userAgent !== 'string' || userAgent.length > maximumLength) {
    return { browser: 'other', os: 'other' };
  }
  return { browser: firstMatch(browserRules, userAgent), os: firstMatch(osRules, userAgent) };
}
