import { createWebPasskeys, createWebPlatform } from '@arca/platform';

/** The web adapters of the platform ports; a native build swaps this module. */
export const passkeys = createWebPasskeys();

const web = createWebPlatform();

/** Undefined where the device cannot keep a wrapped vault identity. */
export const keyStorage = web.capabilities.has('keyStorage') ? web.keyStorage : undefined;

/** Push for this device, and why it is missing where it is (spec 0005, R7). */
export const notifications = web.notifications;
export const notificationsUnavailable = web.capabilities.whyUnavailable('notifications');

/** Choosing files for the vault; undefined where the device cannot pick them. */
export const filePicking = web.capabilities.has('filePicking') ? web.filePicking : undefined;
