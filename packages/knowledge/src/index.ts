import { createRouteCatalog } from './catalog.js';
import { parseEntries } from './entries.js';
import { catalogData } from './generated/catalog.js';

/** The built knowledge catalog. Nothing reads the data directory at runtime (spec 0002, R6). */
export const routeCatalog = createRouteCatalog(parseEntries(catalogData));
