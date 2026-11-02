/**
 * Native capabilities the UI may use (docs/ARCHITECTURE.md, capability ports). UI code asks this
 * port what is available and never checks the operating system (ADR-0005).
 */
export type Capability =
  | 'documentCapture'
  | 'keyStorage'
  | 'biometricUnlock'
  | 'notifications'
  | 'receiveSharedFiles'
  | 'deepLinks';

export interface Capabilities {
  has(capability: Capability): boolean;
}

/** The web adapter: no native capability is offered yet; each arrives with its feature. */
export function createWebCapabilities(): Capabilities {
  return { has: () => false };
}
