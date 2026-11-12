/** How the family area lays out its people, remembered on this device only. */
export const familyLayouts = ['tree', 'cards', 'list'] as const;
export type FamilyLayout = (typeof familyLayouts)[number];

const storageKey = 'arca.family-layout';

/** The layout this device last used; the tree when none was stored or storage is unavailable. */
export function readFamilyLayout(): FamilyLayout {
  try {
    const stored = localStorage.getItem(storageKey);
    return familyLayouts.find((layout) => layout === stored) ?? 'tree';
  } catch {
    return 'tree';
  }
}

export function writeFamilyLayout(layout: FamilyLayout): void {
  try {
    localStorage.setItem(storageKey, layout);
  } catch {
    // Without storage the page opens on the tree next time; nothing else depends on it.
  }
}
