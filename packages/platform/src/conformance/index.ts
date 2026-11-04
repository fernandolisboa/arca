export { capabilitiesConformance } from './capabilities.js';
export { check, ConformanceFailure, rejectsWith, type ConformanceCase } from './check.js';
export { deepLinksConformance, type DeepLinksHarness } from './deep-links.js';
export { filesConformance, type ChosenFile, type FilesHarness } from './files.js';
export { keyStorageConformance, type KeyStorageHarness } from './key-storage.js';
export { notificationsConformance, type NotificationsHarness } from './notifications.js';
export { sharingConformance, type SharingHarness } from './sharing.js';
export { vaultEnvelopesConformance, type VaultEnvelopesHarness } from './vault-envelopes.js';

import type { ConformanceCase } from './check.js';

export interface ConformanceResult {
  readonly name: string;
  readonly error?: string;
}

/** Runs cases one after another, since several share the device's state. */
export async function runConformance(
  cases: readonly ConformanceCase[],
): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];
  for (const { name, run } of cases) {
    try {
      await run();
      results.push({ name });
    } catch (error) {
      results.push({ name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
