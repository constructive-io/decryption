'use strict';
const electron = require('electron');
const CHANNELS = {
  vaultStatus: 'vault:status',
  vaultUnlock: 'vault:unlock',
  vaultLock: 'vault:lock',
  vaultSave: 'vault:save',
  vaultChangePassphrase: 'vault:change-passphrase',
  itemsList: 'items:list',
  itemsGet: 'items:get',
  itemsCreate: 'items:create',
  itemsRename: 'items:rename',
  itemsFavorite: 'items:favorite',
  itemsMove: 'items:move',
  itemsTrash: 'items:trash',
  itemsRestore: 'items:restore',
  itemsDestroy: 'items:destroy',
  itemsSearch: 'items:search',
  fieldsList: 'fields:list',
  fieldsSet: 'fields:set',
  fieldsReveal: 'fields:reveal',
  fieldsRemove: 'fields:remove',
  totpCode: 'totp:code',
  totpList: 'totp:list',
  totpImportUri: 'totp:import-uri',
  foldersList: 'folders:list',
  foldersCreate: 'folders:create',
  foldersDelete: 'folders:delete',
  tagsList: 'tags:list',
  tagsAdd: 'tags:add',
  tagsRemove: 'tags:remove',
  urlsList: 'urls:list',
  urlsAdd: 'urls:add',
  auditLog: 'audit:log',
  wbCreateWallet: 'workbench:create-wallet',
  wbDeriveAccounts: 'workbench:derive-accounts',
  wbEncryptText: 'workbench:encrypt-text',
  wbDecryptText: 'workbench:decrypt-text',
  wbLegacyDecrypt: 'workbench:legacy-decrypt',
  wbShamirSplit: 'workbench:shamir-split',
  wbShamirCombine: 'workbench:shamir-combine',
  lockedEvent: 'vault:locked-event'
};
const invoke = (channel, ...args) => electron.ipcRenderer.invoke(channel, ...args);
const api = {
  vault: {
    status: () => invoke(CHANNELS.vaultStatus),
    unlock: (passphrase) => invoke(CHANNELS.vaultUnlock, passphrase),
    lock: () => invoke(CHANNELS.vaultLock),
    save: () => invoke(CHANNELS.vaultSave),
    changePassphrase: (next) => invoke(CHANNELS.vaultChangePassphrase, next)
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
    search: (query) => invoke(CHANNELS.itemsSearch, query)
  },
  fields: {
    list: (itemId) => invoke(CHANNELS.fieldsList, itemId),
    set: (itemId, name, purpose, value, concealed) => invoke(CHANNELS.fieldsSet, itemId, name, purpose, value, concealed),
    reveal: (itemId, name) => invoke(CHANNELS.fieldsReveal, itemId, name),
    remove: (itemId, name) => invoke(CHANNELS.fieldsRemove, itemId, name)
  },
  totp: {
    code: (itemId) => invoke(CHANNELS.totpCode, itemId),
    list: () => invoke(CHANNELS.totpList),
    importUri: (uri) => invoke(CHANNELS.totpImportUri, uri)
  },
  organize: {
    folders: () => invoke(CHANNELS.foldersList),
    createFolder: (name, parentId) => invoke(CHANNELS.foldersCreate, name, parentId),
    deleteFolder: (id) => invoke(CHANNELS.foldersDelete, id),
    tags: (itemId) => invoke(CHANNELS.tagsList, itemId),
    tag: (itemId, name) => invoke(CHANNELS.tagsAdd, itemId, name),
    untag: (itemId, name) => invoke(CHANNELS.tagsRemove, itemId, name),
    urls: (itemId) => invoke(CHANNELS.urlsList, itemId),
    addUrl: (itemId, url) => invoke(CHANNELS.urlsAdd, itemId, url)
  },
  audit: {
    log: (itemId) => invoke(CHANNELS.auditLog, itemId)
  },
  workbench: {
    createWallet: (networks, words) => invoke(CHANNELS.wbCreateWallet, networks, words),
    deriveAccounts: (mnemonic, networks) => invoke(CHANNELS.wbDeriveAccounts, mnemonic, networks),
    encryptText: (plaintext, passphrase) => invoke(CHANNELS.wbEncryptText, plaintext, passphrase),
    decryptText: (armored, passphrase) => invoke(CHANNELS.wbDecryptText, armored, passphrase),
    legacyDecrypt: (ciphertext, salt) => invoke(CHANNELS.wbLegacyDecrypt, ciphertext, salt),
    shamirSplit: (secret, shares, threshold) => invoke(CHANNELS.wbShamirSplit, secret, shares, threshold),
    shamirCombine: (shares) => invoke(CHANNELS.wbShamirCombine, shares)
  },
  onLocked: (listener) => {
    const wrapped = () => listener();
    electron.ipcRenderer.on(CHANNELS.lockedEvent, wrapped);
    return () => electron.ipcRenderer.removeListener(CHANNELS.lockedEvent, wrapped);
  }
};
electron.contextBridge.exposeInMainWorld('dcrypt', api);
