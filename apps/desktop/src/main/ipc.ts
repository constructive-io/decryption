import { AccountManager } from '@decryption/accounts';
import { decryptFromString, encryptToString } from '@decryption/core';
import { decrypt as legacyDecrypt } from '@decryption/cosmology-compat';
import { combineToString, splitToStrings } from '@decryption/shamir';
import { createWallet, deriveAccounts, WordCount } from '@decryption/wallet';
import { BrowserWindow, ipcMain, shell } from 'electron';
import { existsSync } from 'fs';
import * as path from 'path';

import {
  CHANNELS,
  CreateKeyRequest,
  FieldPurpose,
  ItemKind,
  SignInRequest,
} from '../shared/api';
import { parseOtpauthUri } from '../shared/otpauth';
import { backupVault, restoreVault } from './backup';
import { lookupBrandIcons } from './brand-icons';
import { vaultFilePath,VaultService } from './vault-service';

const WORD_COUNTS: WordCount[] = [12, 15, 18, 21, 24];

/**
 * Registers every IPC handler. Handlers validate their inputs; nothing here
 * trusts the renderer.
 */
export const registerIpc = (service: VaultService): void => {
  const handle = (
    channel: string,
    handler: (...args: never[]) => unknown
  ): void => {
    ipcMain.handle(channel, (_event, ...args) =>
      (handler as (...a: unknown[]) => unknown)(...args)
    );
  };

  // ─── vault lifecycle ───
  handle(CHANNELS.vaultStatus, () => service.status());
  handle(CHANNELS.vaultUnlock, (passphrase: string) => service.unlock(assertString(passphrase)));
  handle(CHANNELS.vaultLock, () => service.lock());
  handle(CHANNELS.vaultSave, () => service.current().save());
  handle(CHANNELS.vaultChangePassphrase, (next: string) =>
    service.current().changePassphrase(assertString(next))
  );
  handle(CHANNELS.vaultRebuild, () => service.rebuild());
  handle(CHANNELS.vaultEraseAll, () => service.eraseAll());

  // ─── items ───
  handle(CHANNELS.itemsList, (options?: { kind?: ItemKind; folderId?: string; trashed?: boolean }) =>
    service.current().listItems(options ?? {})
  );
  handle(CHANNELS.itemsGet, (id: string) => service.current().getItem(assertString(id)));
  handle(CHANNELS.itemsCreate, async (kind: ItemKind, title: string, folderId?: string) => {
    const item = await service.current().createItem(kind, assertString(title), folderId);
    service.scheduleSave();
    return item;
  });
  handle(CHANNELS.itemsRename, async (id: string, title: string) => {
    await service.current().renameItem(assertString(id), assertString(title));
    service.scheduleSave();
  });
  handle(CHANNELS.itemsFavorite, async (id: string, favorite: boolean) => {
    await service.current().setFavorite(assertString(id), Boolean(favorite));
    service.scheduleSave();
  });
  handle(CHANNELS.itemsMove, async (id: string, folderId: string | null) => {
    await service.current().moveToFolder(assertString(id), folderId);
    service.scheduleSave();
  });
  handle(CHANNELS.itemsTrash, async (id: string) => {
    await service.current().trashItem(assertString(id));
    service.scheduleSave();
  });
  handle(CHANNELS.itemsRestore, async (id: string) => {
    await service.current().restoreItem(assertString(id));
    service.scheduleSave();
  });
  handle(CHANNELS.itemsDestroy, async (id: string) => {
    await service.current().deleteItemForever(assertString(id));
    service.scheduleSave();
  });
  handle(CHANNELS.itemsSearch, (query: string) => service.current().searchItems(assertString(query)));

  // ─── fields ───
  handle(CHANNELS.fieldsList, (itemId: string) => service.current().listFields(assertString(itemId)));
  handle(
    CHANNELS.fieldsSet,
    async (itemId: string, name: string, purpose: FieldPurpose, value: string, concealed?: boolean) => {
      await service
        .current()
        .setField(assertString(itemId), assertString(name), purpose, assertString(value), concealed ?? true);
      service.scheduleSave();
    }
  );
  handle(CHANNELS.fieldsReveal, (itemId: string, name: string) =>
    service.current().revealField(assertString(itemId), assertString(name))
  );
  handle(CHANNELS.fieldsRemove, async (itemId: string, name: string) => {
    await service.current().deleteField(assertString(itemId), assertString(name));
    service.scheduleSave();
  });

  // ─── totp ───
  handle(CHANNELS.totpCode, (itemId: string) => service.totpEntry(assertString(itemId)));
  handle(CHANNELS.totpList, () => service.totpList());
  handle(CHANNELS.totpImportUri, async (uri: string) => {
    const parsed = parseOtpauthUri(assertString(uri));
    const title = parsed.issuer ? `${parsed.issuer} (${parsed.label})` : parsed.label;
    const vault = service.current();
    const item = await vault.createItem('totp', title);
    await vault.setField(item.id, 'seed', 'totp_seed', parsed.secret);
    if (parsed.period !== 30) {
      await vault.setField(item.id, 'period', 'text', String(parsed.period), false);
    }
    if (parsed.digits !== 6) {
      await vault.setField(item.id, 'digits', 'text', String(parsed.digits), false);
    }
    service.scheduleSave();
    return item;
  });

  // ─── folders / tags / urls ───
  handle(CHANNELS.foldersList, () => service.current().listFolders());
  handle(CHANNELS.foldersCreate, async (name: string, parentId?: string) => {
    const folder = await service.current().createFolder(assertString(name), parentId);
    service.scheduleSave();
    return folder;
  });
  handle(CHANNELS.foldersDelete, async (id: string) => {
    await service.current().deleteFolder(assertString(id));
    service.scheduleSave();
  });
  handle(CHANNELS.tagsList, (itemId?: string) => service.current().listTags(itemId));
  handle(CHANNELS.tagsAdd, async (itemId: string, name: string) => {
    await service.current().tagItem(assertString(itemId), assertString(name));
    service.scheduleSave();
  });
  handle(CHANNELS.tagsRemove, async (itemId: string, name: string) => {
    await service.current().untagItem(assertString(itemId), assertString(name));
    service.scheduleSave();
  });
  handle(CHANNELS.urlsList, (itemId: string) => service.current().listUrls(assertString(itemId)));
  handle(CHANNELS.urlsAdd, async (itemId: string, url: string) => {
    await service.current().addUrl(assertString(itemId), assertString(url));
    service.scheduleSave();
  });

  // ─── backup ───
  handle(CHANNELS.backupCreate, (): unknown =>
    backupVault(service, BrowserWindow.getFocusedWindow())
  );
  handle(CHANNELS.backupRestore, (): unknown =>
    restoreVault(service, BrowserWindow.getFocusedWindow())
  );
  handle(CHANNELS.backupRevealVault, async (): Promise<void> => {
    const file = vaultFilePath();
    // an absent vault has no item to select, so fall back to its folder
    if (existsSync(file)) shell.showItemInFolder(file);
    else await shell.openPath(path.dirname(file));
  });

  // ─── brand icons (bundled, offline) ───
  handle(CHANNELS.iconsLookup, (names: string[]) => lookupBrandIcons(assertStringArray(names)));

  // ─── constructive accounts ───
  const accounts = (): AccountManager => new AccountManager(service.current());
  const credentials = (request: SignInRequest): SignInRequest => ({
    endpoint: assertString(request?.endpoint),
    email: assertString(request?.email),
    password: assertString(request?.password),
  });

  handle(CHANNELS.accountsList, () => accounts().listAccounts());
  handle(CHANNELS.accountsSignIn, async (request: SignInRequest) => {
    const account = await accounts().signIn(credentials(request));
    service.scheduleSave();
    return account;
  });
  handle(CHANNELS.accountsSignUp, async (request: SignInRequest) => {
    const account = await accounts().signUp(credentials(request));
    service.scheduleSave();
    return account;
  });
  handle(CHANNELS.accountsSignOut, async (itemId: string) => {
    await accounts().signOut(assertString(itemId));
    service.scheduleSave();
  });
  handle(CHANNELS.accountsForget, async (itemId: string) => {
    await accounts().forget(assertString(itemId));
    service.scheduleSave();
  });
  handle(CHANNELS.accountsKeys, (accountItemId?: string) =>
    accounts().listApiKeys(accountItemId === undefined ? undefined : assertString(accountItemId))
  );
  handle(
    CHANNELS.accountsCreateKey,
    async (accountItemId: string, request: CreateKeyRequest) => {
      const days = request?.expiresDays;
      const key = await accounts().createApiKey(assertString(accountItemId), {
        name: assertString(request?.name),
        expiresIn: days === undefined ? undefined : { days: assertInt(days, 1, 3650) },
        accessLevel:
          request?.accessLevel === undefined ? undefined : assertString(request.accessLevel),
      });
      service.scheduleSave();
      return key;
    }
  );
  handle(CHANNELS.accountsRevealKey, (itemId: string) =>
    accounts().revealApiKey(assertString(itemId))
  );
  handle(CHANNELS.accountsRevokeKey, async (itemId: string) => {
    await accounts().revokeApiKey(assertString(itemId));
    service.scheduleSave();
  });

  // ─── audit ───
  handle(CHANNELS.auditLog, (itemId?: string) => service.current().auditLog(itemId));

  // ─── crypto workbench (stateless, works while locked) ───
  handle(CHANNELS.wbCreateWallet, (networks: string[], words: number) => {
    const wordCount = WORD_COUNTS.includes(words as WordCount) ? (words as WordCount) : 24;
    return createWallet(assertStringArray(networks), wordCount);
  });
  handle(CHANNELS.wbDeriveAccounts, (mnemonic: string, networks: string[]) =>
    deriveAccounts(assertString(mnemonic), assertStringArray(networks))
  );
  handle(CHANNELS.wbEncryptText, (plaintext: string, passphrase: string) =>
    encryptToString(assertString(plaintext), assertString(passphrase))
  );
  handle(CHANNELS.wbDecryptText, (armored: string, passphrase: string) =>
    decryptFromString(assertString(armored), assertString(passphrase))
  );
  handle(CHANNELS.wbLegacyDecrypt, (ciphertext: string, salt: string) =>
    legacyDecrypt(assertString(salt), assertString(ciphertext))
  );
  handle(CHANNELS.wbShamirSplit, (secret: string, shares: number, threshold: number) =>
    splitToStrings(assertString(secret), {
      shares: assertInt(shares, 2, 255),
      threshold: assertInt(threshold, 2, 255),
    })
  );
  handle(CHANNELS.wbShamirCombine, (shares: string[]) =>
    combineToString(assertStringArray(shares))
  );
};

const assertString = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('expected a string');
  return value;
};

const assertStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error('expected an array of strings');
  }
  return value as string[];
};

const assertInt = (value: unknown, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`expected an integer between ${min} and ${max}`);
  }
  return value;
};
