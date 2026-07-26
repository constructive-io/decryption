#!/usr/bin/env node
/**
 * Writes package.json / tsconfig / jest config for a first-party package, keeping every
 * manifest in the workspace identical apart from name, description, deps and bin.
 *
 *   node scripts/gen-manifest.js <slug> '<description>' '<keyword,keyword>' '<dep,dep>'
 */
const fs = require('fs');
const path = require('path');

const REPO = 'https://github.com/constructive-io/decryption';

/** Third-party dependency versions, pinned in one place. */
const DEP_VERSIONS = {
  appstash: '^1.4.0',
  inquirerer: '^4.9.1',
  yanse: '^1.4.0',
};
const [, , slug, description, keywords = '', deps = '', extra = '{}'] = process.argv;

if (!slug || !description) {
  console.error("usage: gen-manifest.js <slug> '<description>' '<keywords>' '<deps>' '<extra-json>'");
  process.exit(1);
}

const dir = path.join('packages', slug);
fs.mkdirSync(dir, { recursive: true });

const dependencies = deps
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean)
  .sort()
  .reduce((acc, d) => {
    acc[d] = d.startsWith('@decryption/') ? 'workspace:*' : DEP_VERSIONS[d] ?? '*';
    return acc;
  }, {});

const pkg = {
  name: `@decryption/${slug}`,
  version: '0.1.0',
  description,
  author: 'Constructive <developers@constructive.io>',
  main: 'index.js',
  module: 'esm/index.js',
  types: 'index.d.ts',
  homepage: REPO,
  license: 'MIT',
  publishConfig: { access: 'public', directory: 'dist' },
  repository: { type: 'git', url: REPO },
  bugs: { url: `${REPO}/issues` },
  scripts: {
    copy: 'makage assets',
    clean: 'makage clean',
    prepublishOnly: 'npm run build',
    build: 'makage build',
    lint: 'eslint . --fix',
    test: 'jest',
    'test:watch': 'jest --watch',
  },
  keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
  dependencies,
  devDependencies: { makage: '0.3.0' },
  ...JSON.parse(extra),
};

fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
fs.writeFileSync(
  path.join(dir, 'tsconfig.json'),
  JSON.stringify(
    {
      extends: '../../tsconfig.json',
      compilerOptions: { outDir: 'dist', rootDir: 'src/' },
      include: ['src/**/*.ts'],
      exclude: ['dist', 'node_modules', '**/*.spec.*', '**/*.test.*'],
    },
    null,
    2
  ) + '\n'
);
fs.writeFileSync(
  path.join(dir, 'tsconfig.esm.json'),
  JSON.stringify(
    {
      extends: './tsconfig.json',
      compilerOptions: { outDir: 'dist/esm', module: 'es2022', rootDir: 'src/', declaration: false },
    },
    null,
    2
  ) + '\n'
);
fs.writeFileSync(
  path.join(dir, 'jest.config.js'),
  `/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\\\.tsx?$': [
      'ts-jest',
      {
        babelConfig: false,
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  transformIgnorePatterns: [\`/node_modules/*\`],
  testRegex: '(/__tests__/.*|(\\\\.|/)(test|spec))\\\\.(jsx?|tsx?)$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  modulePathIgnorePatterns: ['dist/*'],
};
`
);

console.log(`wrote ${dir}/package.json`);
