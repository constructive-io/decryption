import { parseHeader } from '@decryption/core';
import { BrowserWindow, dialog } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

import type { BackupResult } from '../shared/api';
import { forget as forgetUnlockKey } from './biometric';
import { vaultFilePath,VaultService } from './vault-service';

/** `dcrypt-vault-2026-08-07-1432.dcrypt` — sorts chronologically in a folder. */
export const backupName = (now = new Date()): string => {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    `${pad(now.getHours())}${pad(now.getMinutes())}`,
  ].join('-');
  return `dcrypt-vault-${stamp}.dcrypt`;
};

/** Rejects anything that is not a dcrypt envelope before it can replace a vault. */
export const assertEnvelope = async (file: string): Promise<void> => {
  parseHeader(new Uint8Array(await fs.readFile(file)));
};

/**
 * Copies the encrypted vault file wherever the user points. The copy is the
 * same sealed envelope as the original: it carries no key material, and only
 * the master password opens it.
 */
export const backupVault = async (
  service: VaultService,
  window: BrowserWindow | null
): Promise<BackupResult> => {
  const source = vaultFilePath();
  // flush pending edits so the copy is not a moment behind the UI
  await service.flush();
  const options = {
    title: 'Back up vault',
    defaultPath: backupName(),
    filters: [{ name: 'Encrypted vault', extensions: ['dcrypt'] }],
    message: 'The backup is encrypted with your master password.',
  };
  const { canceled, filePath } = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  if (canceled || !filePath) return { path: null };
  await fs.copyFile(source, filePath);
  return { path: filePath };
};

/**
 * Replaces the vault with a chosen backup. The vault is locked first and the
 * file it replaces is kept alongside it, so a mistaken restore is recoverable.
 */
export const restoreVault = async (
  service: VaultService,
  window: BrowserWindow | null
): Promise<BackupResult> => {
  const options: Electron.OpenDialogOptions = {
    title: 'Restore from backup',
    properties: ['openFile'],
    filters: [{ name: 'Encrypted vault', extensions: ['dcrypt'] }],
    message: 'Choose a vault backup. Your current vault is kept as a copy.',
  };
  const { canceled, filePaths } = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  const chosen = filePaths[0];
  if (canceled || !chosen) return { path: null };
  await assertEnvelope(chosen);

  const target = vaultFilePath();
  await service.lock();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const kept = path.join(path.dirname(target), `replaced-${backupName()}`);
  const replaced = await fs
    .rename(target, kept)
    .then(() => true)
    .catch(() => false);
  try {
    await fs.copyFile(chosen, target);
  } catch (err) {
    // put the original back rather than leaving no vault at all
    if (replaced) await fs.rename(kept, target).catch(() => undefined);
    throw err;
  }
  // the restored vault may well have a different password than the one this
  // machine remembers, and a remembered password that fails is a dead end
  await forgetUnlockKey();
  return { path: chosen, replaced: replaced ? kept : null };
};
