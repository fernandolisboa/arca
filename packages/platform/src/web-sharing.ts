import {
  CapabilityUnavailableError,
  guarded,
  requireCapability,
  type Capabilities,
} from './capabilities.js';
import type { SharedFiles, Sharing } from './sharing.js';

/** The Web Share API; files only where the browser says it can share them. */
export function createWebSharing(
  capabilities: Capabilities,
  scope: typeof globalThis = globalThis,
): Sharing {
  return {
    async share(content) {
      requireCapability(capabilities, 'sharing');
      const data: ShareData = {
        ...(content.title === undefined ? {} : { title: content.title }),
        ...(content.text === undefined ? {} : { text: content.text }),
        ...(content.url === undefined ? {} : { url: content.url }),
        ...(content.files === undefined ? {} : { files: [...content.files] }),
      };
      if (content.files !== undefined && !scope.navigator.canShare(data)) {
        throw new CapabilityUnavailableError('sharing', 'unsupported');
      }
      try {
        await scope.navigator.share(data);
        return 'shared';
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
        throw error;
      }
    },
  };
}

/** Unavailable until the manifest declares a share target (spec 0005, R5). */
export function createWebSharedFiles(capabilities: Capabilities): SharedFiles {
  return { take: guarded(capabilities, 'receiveSharedFiles', () => []) };
}
