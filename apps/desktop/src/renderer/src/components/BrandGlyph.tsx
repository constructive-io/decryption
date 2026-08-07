import { useEffect, useState } from 'react';

import type { BrandIcon } from '../../../shared/api';
import { dcrypt } from '../lib/ipc';

const cache = new Map<string, BrandIcon | null>();
const pending = new Map<string, Promise<void>>();

/** Resolves brand glyphs through the main process, memoized per title. */
export const useBrandIcons = (names: string[]): Record<string, BrandIcon | null> => {
  const [, setVersion] = useState(0);
  const wanted = names.join('\u0000');

  useEffect(() => {
    const missing = wanted
      .split('\u0000')
      .filter((name) => name && !cache.has(name) && !pending.has(name));
    if (!missing.length) return;
    const request = dcrypt.icons
      .lookup(missing)
      .then((found) => {
        for (const name of missing) cache.set(name, found[name] ?? null);
        setVersion((v) => v + 1);
      })
      .catch(() => {
        for (const name of missing) cache.set(name, null);
      })
      .finally(() => {
        for (const name of missing) pending.delete(name);
      });
    for (const name of missing) pending.set(name, request);
  }, [wanted]);

  return Object.fromEntries(names.map((name) => [name, cache.get(name) ?? null]));
};

/**
 * A service's brand mark, falling back to its initial when simple-icons has no
 * match. Icons are bundled, so nothing is ever fetched from the network.
 */
export const BrandGlyph = ({
  name,
  icon,
  className = 'size-5',
}: {
  name: string;
  icon: BrandIcon | null;
  className?: string;
}) => {
  if (!icon) {
    return (
      <span
        className={`${className} flex shrink-0 items-center justify-center rounded bg-muted text-[0.7em] font-semibold uppercase text-muted-foreground`}
        aria-hidden
      >
        {name.trim().charAt(0) || '?'}
      </span>
    );
  }
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      className={`${className} shrink-0`}
      fill={icon.hex}
      aria-label={icon.title}
    >
      <path d={icon.path} />
    </svg>
  );
};
