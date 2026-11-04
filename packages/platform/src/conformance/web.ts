import { createWebPlatform } from '../web-platform.js';
import { keyStorageDatabase } from '../web-key-storage.js';
import { capabilitiesConformance } from './capabilities.js';
import type { ConformanceCase } from './check.js';
import { deepLinksConformance } from './deep-links.js';
import { filesConformance, type ChosenFile } from './files.js';
import { runConformance, type ConformanceResult } from './index.js';
import { keyStorageConformance } from './key-storage.js';
import { notificationsConformance } from './notifications.js';
import { sharingConformance } from './sharing.js';

export type WebSuite =
  'capabilities' | 'files' | 'keyStorage' | 'notifications' | 'sharing' | 'deepLinks';

function unreachable(what: string): () => Promise<never> {
  return () => Promise.reject(new Error(`${what} cannot be driven in this browser`));
}

/**
 * Runs one suite against the web adapters in the page. The browser automation answers file
 * choosers; the browser itself answers a permission prompt in automation by refusing it.
 */
export function runWebConformance(
  suite: WebSuite,
  chooseFiles: (choice: readonly ChosenFile[]) => Promise<void>,
): Promise<ConformanceResult[]> {
  const platform = createWebPlatform();
  const { capabilities } = platform;
  const suites: Record<WebSuite, () => ConformanceCase[]> = {
    capabilities: () => capabilitiesConformance(capabilities),
    files: () => filesConformance({ ...platform, respond: chooseFiles }),
    keyStorage: () =>
      keyStorageConformance({
        ...platform,
        evict: async () => {
          await new Promise((resolve) => {
            indexedDB.deleteDatabase(keyStorageDatabase).addEventListener('success', resolve);
          });
        },
      }),
    notifications: () =>
      notificationsConformance({
        ...platform,
        answerPrompt: (answer) =>
          answer === 'denied' ? Promise.resolve() : unreachable('granting a prompt')(),
        pushService: false,
      }),
    sharing: () =>
      sharingConformance({
        ...platform,
        answerShareSheet: unreachable('a share sheet'),
        receive: unreachable('a share target'),
      }),
    deepLinks: () => deepLinksConformance({ ...platform, origin: location.origin }),
  };
  return runConformance(suites[suite]());
}
