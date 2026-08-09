import { Vault } from '@decryption/vault';
import { appstash, resolve } from 'appstash';
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';

import type { RebuildReport, TotpEntry, VaultStatus } from '../shared/api';

const APP_NAME = 'dcrypt';

const appDirs = () => appstash(APP_NAME, { ensure: true });

/** Root of everything dcrypt keeps on this machine: vault, keychain, identity. */
export const appDataPath = (): string => appDirs().root;

export const vaultFilePath = (): string =>
  resolve(appDirs(), 'data', 'db') + path.sep + 'vault.dcrypt';

/** Locate the dcrypt-vault pgpm module in dev (workspace) and packaged builds. */
export const vaultModulePath = (): string => {
  const candidates = [
    // packaged: bundled next to the app's resources
    path.join(process.resourcesPath ?? '', 'pgpm-modules', 'dcrypt-vault'),
    // dev: the workspace checkout
    path.resolve(__dirname, '../../../../pgpm-modules/dcrypt-vault'),
    path.resolve(__dirname, '../../../pgpm-modules/dcrypt-vault'),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(path.join(candidate, 'pgpm.plan'))) {
      return candidate;
    }
  }
  throw new Error('cannot locate the dcrypt-vault pgpm module');
};

/**
 * Owns the single vault instance for the app. All key material lives here in
 * the main process; the renderer only ever sees call results.
 */
export class VaultService {
  private vault: Vault | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  /** In-flight lock, so an unlock racing a pending flush waits for it. */
  private locking: Promise<void> | null = null;

  status(): VaultStatus {
    const file = vaultFilePath();
    return {
      exists: existsSync(file),
      unlocked: this.vault !== null && !this.vault.isLocked,
      file,
    };
  }

  async unlock(passphrase: string): Promise<void> {
    await this.locking;
    if (this.vault && !this.vault.isLocked) return;
    this.vault = await Vault.open({
      file: vaultFilePath(),
      passphrase,
      modulePath: vaultModulePath(),
      kdf: 'moderate',
    });
  }

  async lock(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.vault) return;
    const vault = this.vault;
    this.vault = null;
    this.locking = vault.lock().finally(() => {
      this.locking = null;
    });
    await this.locking;
  }

  /** Debounced persistence after mutations. */
  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.current().save();
    }, 2000);
  }

  /**
   * Re-runs the pgpm deploy into a fresh database and moves every row across,
   * so a vault created by an earlier module version picks up schema changes.
   */
  async rebuild(): Promise<RebuildReport> {
    await this.flush();
    return this.current().rebuild(vaultModulePath());
  }

  /**
   * Locks, then deletes every file dcrypt owns. The next launch starts at the
   * create-vault screen, which deploys the pgpm module again from scratch.
   */
  async eraseAll(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    // drop the database without persisting it: the file is about to go
    const vault = this.vault;
    this.vault = null;
    await this.locking;
    if (vault) await vault.discard();
    await fs.rm(appDataPath(), { recursive: true, force: true });
  }

  /** Writes any debounced edits now, so the file on disk matches the UI. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.locking;
    if (this.vault && !this.vault.isLocked) await this.vault.save();
  }

  current(): Vault {
    if (!this.vault || this.vault.isLocked) {
      throw new Error('vault is locked');
    }
    return this.vault;
  }

  /** Null for items that carry no one-time-code seed, e.g. a plain login. */
  async totpEntry(itemId: string): Promise<TotpEntry | null> {
    const vault = this.current();
    const item = await vault.getItem(itemId);
    if (!item) throw new Error('item not found');
    const fields = await vault.listFields(itemId);
    if (!fields.some((field) => field.purpose === 'totp_seed')) return null;
    const numericField = async (name: string, fallback: number): Promise<number> => {
      if (!fields.some((field) => field.name === name)) return fallback;
      const value = Number(await vault.revealField(itemId, name));
      return Number.isInteger(value) && value > 0 ? value : fallback;
    };
    const period = await numericField('period', 30);
    const digits = await numericField('digits', 6);
    const code = await vault.totpCode(itemId, { period, digits });
    const now = Math.floor(Date.now() / 1000);
    return { item, code, period, remaining: period - (now % period) };
  }

  async totpList(): Promise<TotpEntry[]> {
    const vault = this.current();
    const items = await vault.listItems({ kind: 'totp' });
    const entries = await Promise.all(items.map((item) => this.totpEntry(item.id)));
    return entries.filter((entry): entry is TotpEntry => entry !== null);
  }
}
