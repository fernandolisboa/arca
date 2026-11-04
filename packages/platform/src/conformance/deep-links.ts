import type { Capabilities } from '../capabilities.js';
import type { DeepLinks } from '../deep-links.js';
import { check, rejectsWith, type ConformanceCase } from './check.js';

export interface DeepLinksHarness {
  readonly capabilities: Capabilities;
  readonly deepLinks: DeepLinks;
  /** Where the adapter's links point: the app's origin. */
  readonly origin: string;
}

const notPaths = [
  'https://evil.example.com/cases',
  '//evil.example.com/cases',
  '/\\evil.example.com',
  '/\t/evil.example.com',
  '/\n/evil.example.com',
  '/\r/evil.example.com',
  ' //evil.example.com',
  'javascript:alert(1)',
  'cases',
  '',
];

export function deepLinksConformance(harness: DeepLinksHarness): ConformanceCase[] {
  const { capabilities, deepLinks, origin } = harness;
  if (!capabilities.has('deepLinks')) {
    return [
      {
        name: 'refuses every call while unavailable',
        run: () => rejectsWith(() => deepLinks.linkTo('/'), 'CapabilityUnavailableError'),
      },
    ];
  }
  return [
    {
      name: 'links to an app path on the app origin',
      run: async () => {
        const link = new URL(deepLinks.linkTo('/cases?tab=plan#steps'));
        check(link.origin === origin, `the link left the origin: ${link.origin}`);
        check(link.pathname + link.search + link.hash === '/cases?tab=plan#steps', 'path lost');
        await Promise.resolve();
      },
    },
    ...notPaths.map((path) => ({
      name: `refuses ${JSON.stringify(path)}`,
      run: () => rejectsWith(() => deepLinks.linkTo(path), 'NotAnAppPathError'),
    })),
    {
      name: 'stops listening',
      run: async () => {
        const stop = deepLinks.listen(() => undefined);
        stop();
        await Promise.resolve();
      },
    },
  ];
}
