import { arcaConfig } from './index.js';

export default [{ ignores: ['test/fixtures/**'] }, ...arcaConfig({ rootDir: import.meta.dirname })];
