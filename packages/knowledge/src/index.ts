import { createRouteCatalog } from './catalog.js';
import { catalogEntries } from './entries.js';

/** The built knowledge catalog. Nothing reads the data directory at runtime (spec 0002, R6). */
export const routeCatalog = createRouteCatalog(catalogEntries);
