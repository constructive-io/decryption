/**
 * Vendors the svgl (MIT, github.com/pheralb/svgl) logo library into
 * src/main/svgl-icons.json so the app ships full-colour brand marks offline —
 * it never touches api.svgl.app at runtime.
 *
 * Usage: node scripts/vendor-svgl.mjs <path-to-svgl-checkout>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const svglRoot = resolve(process.argv[2] ?? '');
if (!svglRoot) {
  console.error('usage: node scripts/vendor-svgl.mjs <path-to-svgl-checkout>');
  process.exit(1);
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'svgl-icons.json');

// the data file is a plain object-literal array behind a type annotation
const source = readFileSync(join(svglRoot, 'src/data/svgs.ts'), 'utf8')
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/export const svgs: iSVG\[\] =/, 'return');
const entries = new Function(source)();

/** Inline SVG is rendered as markup, so drop anything executable. */
const sanitize = (svg) =>
  svg
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

const readSvg = (route) => sanitize(readFileSync(join(svglRoot, 'static', route.replace(/^\//, '')), 'utf8'));

const BANNED = /1password|authy/i;

// a few logos are elaborate illustrations; at this size they only ever render
// as a smudge, so the monochrome simple-icons fallback serves them better
const MAX_BYTES = 16_384;

const icons = {};
let skipped = 0;
for (const entry of entries) {
  if (BANNED.test(entry.title)) continue;
  const route = entry.route;
  try {
    const light = typeof route === 'string' ? readSvg(route) : readSvg(route.light);
    const dark = typeof route === 'string' ? light : readSvg(route.dark);
    if (light.length > MAX_BYTES || dark.length > MAX_BYTES) {
      skipped += 1;
      continue;
    }
    const slug = (typeof route === 'string' ? route : route.light)
      .replace(/^\/library\//, '')
      .replace(/\.svg$/, '')
      // variant files are named foo-light.svg / foo_dark.svg
      .replace(/[-_](light|dark)$/, '');
    icons[entry.title] = { title: entry.title, slug, light, ...(dark === light ? {} : { dark }) };
  } catch {
    // a handful of entries reference wordmark-only assets
  }
}

writeFileSync(out, `${JSON.stringify(icons)}\n`);
console.log(`wrote ${Object.keys(icons).length} icons (${skipped} too large) -> ${out}`);
