// Flat config, shared by every package: each package's `eslint .` resolves this file by walking up.
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const prettier = require('eslint-config-prettier');
const simpleImportSort = require('eslint-plugin-simple-import-sort');
const unusedImports = require('eslint-plugin-unused-imports');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/esm/**',
      // vendored forks — upstream code, linted (and formatted) by its own project
      'packages/{hashes,ciphers,curves,base,bip39,bip32}/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.{ts,tsx,js,jsx,cjs,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, ...globals.jest },
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    rules: {
      indent: ['error', 2, { SwitchCase: 1 }],
      quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
      'quote-props': ['error', 'as-needed'],
      semi: ['error', 'always'],
      'simple-import-sort/imports': 1,
      'simple-import-sort/exports': 1,
      'unused-imports/no-unused-imports': 1,
      '@typescript-eslint/no-unused-vars': [1, { argsIgnorePattern: 'React|res|next|^_' }],
      '@typescript-eslint/no-explicit-any': 0,
      '@typescript-eslint/no-var-requires': 0,
      '@typescript-eslint/no-require-imports': 0,
      '@typescript-eslint/ban-ts-comment': 0,
      '@typescript-eslint/no-unsafe-declaration-merging': 0,
      'no-console': 0,
      'prefer-const': 0,
      'no-case-declarations': 0,
      'no-implicit-globals': 0,
    },
  },
];
