#!/usr/bin/env node
/**
 * Generates package.json / tsconfig / jest config / README for the vendored forks.
 * Workspace dependencies are detected from the vendored sources.
 */
const fs = require('fs');
const path = require('path');

const FORKS = {
  hashes: {
    upstream: '@noble/hashes',
    version: '2.2.0',
    description:
      'Audited & minimal 0-dependency JS implementation of SHA, RIPEMD, BLAKE, HMAC, HKDF, PBKDF2, Scrypt & Argon2. Dual CJS+ESM fork of @noble/hashes.',
    keywords: ['sha256', 'sha512', 'sha3', 'blake3', 'hmac', 'hkdf', 'pbkdf2', 'scrypt', 'argon2', 'hash'],
  },
  ciphers: {
    upstream: '@noble/ciphers',
    version: '2.2.0',
    description:
      'Audited & minimal 0-dependency JS implementation of AES, ChaCha20-Poly1305 and XChaCha20-Poly1305. Dual CJS+ESM fork of @noble/ciphers.',
    keywords: ['aes', 'gcm', 'chacha', 'xchacha', 'poly1305', 'aead', 'cipher', 'encryption'],
  },
  curves: {
    upstream: '@noble/curves',
    version: '2.2.0',
    description:
      'Audited & minimal 0-dependency JS implementation of elliptic curves: secp256k1, ed25519, x25519. Dual CJS+ESM fork of @noble/curves.',
    keywords: ['secp256k1', 'ed25519', 'x25519', 'elliptic', 'curve', 'signature'],
  },
  base: {
    upstream: '@scure/base',
    version: '2.2.0',
    description:
      'Audited & minimal 0-dependency implementation of bech32, base64, base58, base32 & base16. Dual CJS+ESM fork of @scure/base.',
    keywords: ['base64', 'base58', 'base32', 'bech32', 'hex', 'encoding'],
  },
  bip39: {
    upstream: '@scure/bip39',
    version: '2.2.0',
    description:
      'Audited & minimal implementation of BIP39 mnemonic phrases. Dual CJS+ESM fork of @scure/bip39.',
    keywords: ['bip39', 'mnemonic', 'wallet', 'seed', 'wordlist'],
  },
  bip32: {
    upstream: '@scure/bip32',
    version: '2.2.0',
    description:
      'Audited & minimal implementation of BIP32 hierarchical deterministic (HD) wallets. Dual CJS+ESM fork of @scure/bip32.',
    keywords: ['bip32', 'hd', 'wallet', 'derivation', 'hdkey'],
  },
};

const REPO = 'https://github.com/constructive-io/decryption';

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith('.ts') ? [full] : [];
  });

const detectDeps = (slug, dir) => {
  const deps = new Set();
  for (const file of walk(path.join(dir, 'src'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      const m = /^\s*(?:import|export)[^;]*from '(@decryption\/[a-z0-9-]+)/.exec(line);
      if (m && m[1] !== `@decryption/${slug}`) deps.add(m[1]);
    }
  }
  return [...deps].sort().reduce((acc, name) => ({ ...acc, [name]: 'workspace:*' }), {});
};

const jestConfig = `/** @type {import('ts-jest').JestConfigWithTsJest} */
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
`;

const tsconfig = {
  extends: '../../tsconfig.json',
  compilerOptions: { outDir: 'dist', rootDir: 'src/' },
  include: ['src/**/*.ts'],
  exclude: ['dist', 'node_modules', '**/*.spec.*', '**/*.test.*'],
};

const tsconfigEsm = {
  extends: './tsconfig.json',
  compilerOptions: { outDir: 'dist/esm', module: 'es2022', rootDir: 'src/', declaration: false },
};

for (const [slug, meta] of Object.entries(FORKS)) {
  const dir = path.join('packages', slug);
  const name = `@decryption/${slug}`;

  const pkg = {
    name,
    version: '0.1.0',
    description: meta.description,
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
      build: 'makage build && cp LICENSE dist/LICENSE',
      lint: 'eslint . --fix',
      test: 'jest',
      'test:watch': 'jest --watch',
    },
    keywords: meta.keywords,
    dependencies: detectDeps(slug, dir),
    devDependencies: { makage: '0.3.0' },
  };

  if (!Object.keys(pkg.dependencies).length) delete pkg.dependencies;

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'tsconfig.esm.json'), JSON.stringify(tsconfigEsm, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'jest.config.js'), jestConfig);

  const readme = `# ${name}

> **NOTE:** This is a fork of [\`${meta.upstream}\`](https://www.npmjs.com/package/${meta.upstream}) (v${meta.version}).
> We dual-publish as both **CJS and ESM** because upstream is ESM-only (\`"type": "module"\`), which breaks
> \`require()\` in Jest, older bundlers and CJS-based Node.js tooling. The source is unchanged from upstream —
> only the build tooling differs, plus \`@noble/*\` / \`@scure/*\` import specifiers are rewritten to their
> \`@decryption/*\` forks.

${meta.description}

## Installation

\`\`\`bash
npm install ${name}
\`\`\`

## Usage

Import submodules directly — \`dist/\` is the package root once published, so deep imports work in both CJS and ESM:

\`\`\`typescript
import { sha256 } from '@decryption/hashes/sha2';
import { xchacha20poly1305 } from '@decryption/ciphers/chacha';
\`\`\`

Refer to the [upstream documentation](https://github.com/paulmillr/${meta.upstream.split('/')[1]}) for the full API.

## Syncing upstream

\`\`\`bash
./scripts/vendor-fork.sh ${meta.upstream} <version> ${slug}
node scripts/fix-imports.js packages/${slug} ${slug}
pnpm --filter ${name} build && pnpm --filter ${name} test
\`\`\`

## License

MIT — Copyright (c) 2022 Paul Miller (https://paulmillr.com). See [LICENSE](./LICENSE).
`;
  fs.writeFileSync(path.join(dir, 'README.md'), readme);
  console.log(`${name}: deps=${JSON.stringify(pkg.dependencies || {})}`);
}
