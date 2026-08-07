import * as simpleIcons from 'simple-icons';

import type { BrandIcon } from '../shared/api';

/**
 * Brand glyphs for vault items, resolved from the bundled simple-icons set.
 * Lookup happens here rather than in the renderer so the ~3,400 icons never
 * enter the renderer bundle — and so nothing is ever fetched from the network.
 */
const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|dev|app|xyz)\b.*$/, '')
    .replace(/[^a-z0-9]/g, '');

const index = ((): Map<string, BrandIcon> => {
  const map = new Map<string, BrandIcon>();
  for (const icon of Object.values(simpleIcons)) {
    if (typeof icon !== 'object' || icon === null || !('slug' in icon)) continue;
    const { title, slug, path, hex } = icon as { title: string; slug: string; path: string; hex: string };
    const entry: BrandIcon = { title, slug, path, hex: `#${hex}` };
    for (const key of [normalize(slug), normalize(title)]) {
      if (key && !map.has(key)) map.set(key, entry);
    }
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
