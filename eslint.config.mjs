import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', 'design/**', '**/*.dc.html'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/api/**/*.ts', 'apps/worker/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // NestJS dependency injection requires VALUE imports of injected classes:
    // a type-only import erases the decorator metadata DI resolves with, and
    // the injector then fails at runtime. The health controller is the canary
    // test for exactly this.
    files: ['apps/api/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { globals: { ...globals.node, ...globals.commonjs } },
  },
  {
    // The worker's structured stdout log is its interface for now,
    // and a CLI's printed output is the whole point of running it.
    files: ['apps/worker/src/main.ts', 'apps/api/src/cli/**'],
    rules: { 'no-console': 'off' },
  },
);
