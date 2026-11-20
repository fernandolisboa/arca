import { storedChoice } from './stored-choice.js';

/** How the family area lays out its people, remembered on this device only. */
export const familyLayouts = ['tree', 'cards', 'list'] as const;
export type FamilyLayout = (typeof familyLayouts)[number];

const stored = storedChoice<FamilyLayout>('arca.family-layout', familyLayouts, 'tree');

/** The layout this device last used; the tree when none was stored or storage is unavailable. */
export const readFamilyLayout = stored.read;
export const writeFamilyLayout = stored.write;
