/**
 * Native capabilities the UI may use (docs/ARCHITECTURE.md, capability ports). UI code asks this
 * port what is available and never checks the operating system (ADR-0005).
 */
export type Capability =
  | 'documentCapture'
  | 'filePicking'
  | 'keyStorage'
  | 'notifications'
  | 'receiveSharedFiles'
  | 'sharing'
  | 'deepLinks';

export const capabilities: readonly Capability[] = [
  'documentCapture',
  'filePicking',
  'keyStorage',
  'notifications',
  'receiveSharedFiles',
  'sharing',
  'deepLinks',
];

/**
 * Why a capability is missing, so the UI can show the matching i18n message: `needs-install`
 * means it works once the app is added to the home screen (web push on iOS).
 */
export type Unavailability = 'unsupported' | 'needs-install';

export interface Capabilities {
  has(capability: Capability): boolean;
  /** `undefined` when the capability is available. */
  whyUnavailable(capability: Capability): Unavailability | undefined;
}

/** A port method was called for a capability the running adapter does not have. */
export class CapabilityUnavailableError extends Error {
  override name = 'CapabilityUnavailableError';
  readonly capability: Capability;
  readonly reason: Unavailability;
  constructor(capability: Capability, reason: Unavailability) {
    super(`${capability} is unavailable: ${reason}`);
    this.capability = capability;
    this.reason = reason;
  }
}

export function capabilitiesFrom(
  unavailable: Partial<Record<Capability, Unavailability | undefined>>,
): Capabilities {
  return {
    has: (capability) => unavailable[capability] === undefined,
    whyUnavailable: (capability) => unavailable[capability],
  };
}

/** Throws when the capability is missing; every port method starts with it. */
export function requireCapability(capabilities: Capabilities, capability: Capability): void {
  const reason = capabilities.whyUnavailable(capability);
  if (reason !== undefined) throw new CapabilityUnavailableError(capability, reason);
}

/** A port method that rejects while its capability is missing. */
export function guarded<Args extends unknown[], Result>(
  capabilities: Capabilities,
  capability: Capability,
  method: (...args: Args) => Result | Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    requireCapability(capabilities, capability);
    return await method(...args);
  };
}
