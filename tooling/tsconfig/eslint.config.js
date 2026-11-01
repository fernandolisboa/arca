import { arcaConfig } from '@arca/eslint-config';

export default [{ ignores: ['test/fixtures/**'] }, ...arcaConfig({ rootDir: import.meta.dirname })];
