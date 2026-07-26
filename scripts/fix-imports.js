#!/usr/bin/env node
/**
 * Normalizes import specifiers in vendored fork sources:
 *   - self-referencing `@decryption/<self>/a/b.js` -> relative `./a/b`
 *   - cross-package `@decryption/<other>/a/b.js`   -> `@decryption/<other>/a/b`
 * Run from the repo root: node scripts/fix-imports.js <package-dir> <package-slug>
 */
const fs = require('fs');
const path = require('path');

const [, , pkgDir, slug] = process.argv;
if (!pkgDir || !slug) {
  console.error('usage: fix-imports.js <package-dir> <package-slug>');
  process.exit(1);
}

const srcRoot = path.join(pkgDir, 'src');

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });

let changed = 0;
for (const file of walk(srcRoot)) {
  const before = fs.readFileSync(file, 'utf8');
  const fromDir = path.dirname(file);

  const after = before
    .replace(new RegExp(`'@decryption/${slug}/([^']+?)(\\.js)?'`, 'g'), (_m, target) => {
      let rel = path.relative(fromDir, path.join(srcRoot, target));
      if (!rel.startsWith('.')) rel = `./${rel}`;
      return `'${rel}'`;
    })
    .replace(/'(@decryption\/[a-z0-9-]+\/[^']+?)\.js'/g, "'$1'");

  if (after !== before) {
    fs.writeFileSync(file, after);
    changed++;
  }
}

console.log(`${slug}: rewrote imports in ${changed} file(s)`);
