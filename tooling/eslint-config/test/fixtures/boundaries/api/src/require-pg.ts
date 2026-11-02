import { createRequire } from 'node:module';

export const driver: unknown = createRequire(import.meta.url)('pg');
