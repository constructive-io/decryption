import { contextBridge, ipcRenderer } from 'electron';

import { CHANNELS, DcryptApi } from '../shared/api';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: DcryptApi & {
  onLocked(listener: () => void): () => void;
  onSystemThemeChange(listener: (dark: boolean) => void): () => void;
} = {
  vault: {
    status: () => invoke(CHANNELS.vaultStatus),
    unlock: (passphrase) => invoke(CHANNELS.vaultUnlock, passphrase),
    lock: () => invoke(CHANNELS.vaultLock),
    save: () => invoke(CHANNELS.vaultSave),
    changePassphrase: (next) => invoke(CHANNELS.vaultChangePassphrase, next),
    rebuild: () => invoke(CHANNELS.vaultRebuild),
    eraseAll: () => invoke(CHANNELS.vaultEraseAll),
  },
  items: {
    list: (options) => invoke(CHANNELS.itemsList, options),
    get: (id) => invoke(CHANNELS.itemsGet, id),
    create: (kind, title, folderId) => invoke(CHANNELS.itemsCreate, kind, title, folderId),
    rename: (id, title) => invoke(CHANNELS.itemsRename, id, title),
    favorite: (id, favorite) => invoke(CHANNELS.itemsFavorite, id, favorite),
    move: (id, folderId) => invoke(CHANNELS.itemsMove, id, folderId),
    trash: (id) => invoke(CHANNELS.itemsTrash, id),
    restore: (id) => invoke(CHANNELS.itemsRestore, id),
    destroy: (id) => invoke(CHANNELS.itemsDestroy, id),
    search: (query) => invoke(CHANNELS.itemsSearch, query),
  },
  fields: {
    list: (itemId) => invoke(CHANNELS.fieldsList, itemId),
    set: (itemId, name, purpose, value, concealed) =>
      invoke(CHANNELS.fieldsSet, itemId, name, purpose, value, concealed),
    reveal: (itemId, name) => invoke(CHANNELS.fieldsReveal, itemId, name),
    remove: (itemId, name) => invoke(CHANNELS.fieldsRemove, itemId, name),
  },
  totp: {
    code: (itemId) => invoke(CHANNELS.totpCode, itemId),
    list: () => invoke(CHANNELS.totpList),
    importUri: (uri) => invoke(CHANNELS.totpImportUri, uri),
  },
  organize: {
    folders: () => invoke(CHANNELS.foldersList),
    createFolder: (name, parentId) => invoke(CHANNELS.foldersCreate, name, parentId),
    deleteFolder: (id) => invoke(CHANNELS.foldersDelete, id),
    tags: (itemId) => invoke(CHANNELS.tagsList, itemId),
    tag: (itemId, name) => invoke(CHANNELS.tagsAdd, itemId, name),
    untag: (itemId, name) => invoke(CHANNELS.tagsRemove, itemId, name),
    urls: (itemId) => invoke(CHANNELS.urlsList, itemId),
    addUrl: (itemId, url) => invoke(CHANNELS.urlsAdd, itemId, url),
  },
  accounts: {
    list: () => invoke(CHANNELS.accountsList),
    signIn: (request) => invoke(CHANNELS.accountsSignIn, request),
    signUp: (request) => invoke(CHANNELS.accountsSignUp, request),
    signOut: (itemId) => invoke(CHANNELS.accountsSignOut, itemId),
    forget: (itemId) => invoke(CHANNELS.accountsForget, itemId),
    keys: (accountItemId) => invoke(CHANNELS.accountsKeys, accountItemId),
    createKey: (accountItemId, request, stepUp) =>
      invoke(CHANNELS.accountsCreateKey, accountItemId, request, stepUp),
    revealKey: (itemId) => invoke(CHANNELS.accountsRevealKey, itemId),
    revokeKey: (itemId, stepUp) => invoke(CHANNELS.accountsRevokeKey, itemId, stepUp),
    assignKeyToDatabase: (itemId, databaseId) =>
      invoke(CHANNELS.accountsAssignKeyDatabase, itemId, databaseId),
    principals: (accountItemId) => invoke(CHANNELS.accountsPrincipals, accountItemId),
    createPrincipal: (accountItemId, request, stepUp) =>
      invoke(CHANNELS.accountsCreatePrincipal, accountItemId, request, stepUp),
    deletePrincipal: (accountItemId, principalId, stepUp) =>
      invoke(CHANNELS.accountsDeletePrincipal, accountItemId, principalId, stepUp),
    linkTotp: (accountItemId, totpItemId) =>
      invoke(CHANNELS.accountsLinkTotp, accountItemId, totpItemId),
    unlinkTotp: (accountItemId) => invoke(CHANNELS.accountsUnlinkTotp, accountItemId),
  },
  audit: {
    log: (itemId) => invoke(CHANNELS.auditLog, itemId),
  },
  workbench: {
    createWallet: (networks, words) => invoke(CHANNELS.wbCreateWallet, networks, words),
    deriveAccounts: (mnemonic, networks) => invoke(CHANNELS.wbDeriveAccounts, mnemonic, networks),
    encryptText: (plaintext, passphrase) => invoke(CHANNELS.wbEncryptText, plaintext, passphrase),
    decryptText: (armored, passphrase) => invoke(CHANNELS.wbDecryptText, armored, passphrase),
    legacyDecrypt: (ciphertext, salt) => invoke(CHANNELS.wbLegacyDecrypt, ciphertext, salt),
    shamirSplit: (secret, shares, threshold) =>
      invoke(CHANNELS.wbShamirSplit, secret, shares, threshold),
    shamirCombine: (shares) => invoke(CHANNELS.wbShamirCombine, shares),
  },
  backup: {
    create: () => invoke(CHANNELS.backupCreate),
    restore: () => invoke(CHANNELS.backupRestore),
    revealVault: () => invoke(CHANNELS.backupRevealVault),
  },
  unlockKey: {
    status: () => invoke(CHANNELS.unlockKeyStatus),
    enrol: (passphrase) => invoke(CHANNELS.unlockKeyEnrol, passphrase),
    forget: () => invoke(CHANNELS.unlockKeyForget),
    unlock: () => invoke(CHANNELS.unlockKeyUnlock),
  },
  clipboard: {
    copy: (value, seconds) => invoke(CHANNELS.clipboardCopy, value, seconds),
  },
  icons: {
    lookup: (names) => invoke(CHANNELS.iconsLookup, names),
  },
  theme: {
    getSystemDark: () => invoke(CHANNELS.themeGetSystemDark),
  },
  onSystemThemeChange: (listener) => {
    const wrapped = (_event: unknown, dark: boolean) => listener(dark);
    ipcRenderer.on(CHANNELS.themeSystemChanged, wrapped);
    return () => ipcRenderer.removeListener(CHANNELS.themeSystemChanged, wrapped);
  },
  onLocked: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on(CHANNELS.lockedEvent, wrapped);
    return () => ipcRenderer.removeListener(CHANNELS.lockedEvent, wrapped);
  },
};

contextBridge.exposeInMainWorld('dcrypt', api);

export type ExposedApi = typeof api;
