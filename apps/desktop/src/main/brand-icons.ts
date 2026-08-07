import * as simpleIcons from 'simple-icons';

import type { BrandIcon } from '../shared/api';
import svglIcons from './svgl-icons.json';

/**
 * Brand marks for vault items. Full-colour logos come from the vendored svgl
 * library, falling back to simple-icons' monochrome glyphs. Both sets are
 * bundled, so nothing is ever fetched — the app never reveals which services
 * you hold accounts with. Lookup runs here rather than in the renderer to keep
 * ~4,000 icons out of the renderer bundle.
 */
const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|dev|app|xyz)\b.*$/, '')
    .replace(/[^a-z0-9]/g, '');

interface SvglEntry {
  title: string;
  slug: string;
  light: string;
  dark?: string;
}

const index = ((): Map<string, BrandIcon> => {
  const map = new Map<string, BrandIcon>();
  const add = (key: string, icon: BrandIcon): void => {
    if (key && !map.has(key)) map.set(key, icon);
  };

  // simple-icons first so svgl's colour art overrides it below
  for (const icon of Object.values(simpleIcons)) {
    if (typeof icon !== 'object' || icon === null || !('slug' in icon)) continue;
    const { title, slug, path, hex } = icon as {
      title: string;
      slug: string;
      path: string;
      hex: string;
    };
    const entry: BrandIcon = { kind: 'glyph', title, slug, path, hex: `#${hex}` };
    add(normalize(slug), entry);
    add(normalize(title), entry);
  }

  for (const entry of Object.values(svglIcons as Record<string, SvglEntry>)) {
    const icon: BrandIcon = {
      kind: 'logo',
      title: entry.title,
      slug: entry.slug,
      light: entry.light,
      dark: entry.dark ?? entry.light,
    };
    map.set(normalize(entry.slug), icon);
    map.set(normalize(entry.title), icon);
  }
  return map;
})();

/**
 * Best-effort match for a vault item's title. Tries the whole title first, then
 * its leading words, so "GitHub (alice@example.com)" and "Coinbase Pro" both hit.
 */
export const lookupBrandIcon = (name: string): BrandIcon | null => {
  const direct = index.get(normalize(name));
  if (direct) return direct;
  const words = name.split(/[\s:/(),—-]+/).filter(Boolean);
  for (let count = words.length; count > 0; count--) {
    const candidate = index.get(normalize(words.slice(0, count).join('')));
    if (candidate) return candidate;
  }
  return null;
};

export const lookupBrandIcons = (names: string[]): Record<string, BrandIcon | null> =>
  Object.fromEntries(names.map((name) => [name, lookupBrandIcon(name)]));
