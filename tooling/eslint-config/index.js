import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Shared flat config. Each package calls it from its own eslint.config.js with its directory,
 * so typed linting resolves that package's tsconfig.
 *
 * @param {{ rootDir: string }} options
 * @returns {import('typescript-eslint').ConfigArray}
 */
export function arcaConfig({ rootDir }) {
  return tseslint.config(
    { ignores: ['dist/**', 'coverage/**'] },
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        globals: globals.node,
        parserOptions: {
          projectService: { allowDefaultProject: ['*.config.js', '*.config.ts'] },
          tsconfigRootDir: rootDir,
        },
      },
      linterOptions: { reportUnusedDisableDirectives: 'error' },
    },
    {
      files: ['**/*.js'],
      extends: [tseslint.configs.disableTypeChecked],
    },
  );
}
