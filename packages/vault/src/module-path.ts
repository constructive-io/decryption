import { existsSync } from 'fs';
import * as path from 'path';

/**
 * Locates the `dcrypt-vault` pgpm module directory, used to deploy a fresh
 * vault. Resolution order:
 *
 * 1. `DCRYPT_VAULT_MODULE` environment variable
 * 2. `module/dcrypt-vault` bundled inside this package (published builds)
 * 3. `pgpm-modules/dcrypt-vault` walking up from this package (workspace)
 */
export const defaultModulePath = (): string => {
  const fromEnv = process.env.DCRYPT_VAULT_MODULE;
  if (fromEnv && existsSync(path.join(fromEnv, 'pgpm.plan'))) {
    return fromEnv;
  }

  const bundled = path.resolve(__dirname, '../module/dcrypt-vault');
  if (existsSync(path.join(bundled, 'pgpm.plan'))) {
    return bundled;
  }

  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'pgpm-modules', 'dcrypt-vault');
    if (existsSync(path.join(candidate, 'pgpm.plan'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    'cannot locate the dcrypt-vault pgpm module; set DCRYPT_VAULT_MODULE to its directory'
  );
};
