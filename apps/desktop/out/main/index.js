'use strict';
const electron = require('electron');
const path = require('path');
const core = require('@decryption/core');
const legacy = require('@decryption/legacy');
const shamir = require('@decryption/shamir');
const wallet = require('@decryption/wallet');
const vault = require('@decryption/vault');
const appstash = require('appstash');
const fs = require('fs');
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: 'Module' } });
  if (e) {
    for (const k in e) {
      if (k !== 'default') {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
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
const BASE32_RE = /^[A-Z2-7]+=*$/;
const parseOtpauthUri = (uri) => {
  let url;
  try {
    url = new URL(uri);
  } catch {
    throw new Error('not a valid otpauth:// URI');
  }
  if (url.protocol !== 'otpauth:') {
    throw new Error('not a valid otpauth:// URI');
  }
  if (url.host !== 'totp') {
    throw new Error(`unsupported otpauth type "${url.host}" — only totp is supported`);
  }
  const label = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const secret = (url.searchParams.get('secret') ?? '').toUpperCase().replace(/\s+/g, '');
  if (!secret || !BASE32_RE.test(secret)) {
    throw new Error('otpauth URI is missing a valid base32 secret');
  }
  const issuerParam = url.searchParams.get('issuer') ?? void 0;
  const [labelIssuer, account] = label.includes(':') ? [label.slice(0, label.indexOf(':')), label.slice(label.indexOf(':') + 1)] : [void 0, label];
  const algorithm = (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase();
  if (!['SHA1', 'SHA256', 'SHA512'].includes(algorithm)) {
    throw new Error(`unsupported algorithm "${algorithm}"`);
  }
  const period = Number(url.searchParams.get('period') ?? 30);
  const digits = Number(url.searchParams.get('digits') ?? 6);
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error('otpauth period must be a positive integer');
  }
  if (![6, 7, 8].includes(digits)) {
    throw new Error('otpauth digits must be 6, 7 or 8');
  }
  return {
    label: account.trim(),
    issuer: issuerParam ?? labelIssuer,
    secret,
    period,
    digits,
    algorithm
  };
};
const WORD_COUNTS = [12, 15, 18, 21, 24];
const registerIpc = (service2) => {
  const handle = (channel, handler) => {
    electron.ipcMain.handle(
      channel,
      (_event, ...args) => handler(...args)
    );
  };
  handle(CHANNELS.vaultStatus, () => service2.status());
  handle(CHANNELS.vaultUnlock, (passphrase) => service2.unlock(assertString(passphrase)));
  handle(CHANNELS.vaultLock, () => service2.lock());
  handle(CHANNELS.vaultSave, () => service2.current().save());
  handle(
    CHANNELS.vaultChangePassphrase,
    (next) => service2.current().changePassphrase(assertString(next))
  );
  handle(
    CHANNELS.itemsList,
    (options) => service2.current().listItems(options ?? {})
  );
  handle(CHANNELS.itemsGet, (id) => service2.current().getItem(assertString(id)));
  handle(CHANNELS.itemsCreate, async (kind, title, folderId) => {
    const item = await service2.current().createItem(kind, assertString(title), folderId);
    service2.scheduleSave();
    return item;
  });
  handle(CHANNELS.itemsRename, async (id, title) => {
    await service2.current().renameItem(assertString(id), assertString(title));
    service2.scheduleSave();
  });
  handle(CHANNELS.itemsFavorite, async (id, favorite) => {
    await service2.current().setFavorite(assertString(id), Boolean(favorite));
    service2.scheduleSave();
  });
  handle(CHANNELS.itemsMove, async (id, folderId) => {
    await service2.current().moveToFolder(assertString(id), folderId);
    service2.scheduleSave();
  });
  handle(CHANNELS.itemsTrash, async (id) => {
    await service2.current().trashItem(assertString(id));
    service2.scheduleSave();
  });
  handle(CHANNELS.itemsRestore, async (id) => {
    await service2.current().restoreItem(assertString(id));
    service2.scheduleSave();
  });
  handle(CHANNELS.itemsDestroy, async (id) => {
    await service2.current().deleteItemForever(assertString(id));
    service2.scheduleSave();
  });
  handle(CHANNELS.itemsSearch, (query) => service2.current().searchItems(assertString(query)));
  handle(CHANNELS.fieldsList, (itemId) => service2.current().listFields(assertString(itemId)));
  handle(
    CHANNELS.fieldsSet,
    async (itemId, name, purpose, value, concealed) => {
      await service2.current().setField(assertString(itemId), assertString(name), purpose, assertString(value), concealed ?? true);
      service2.scheduleSave();
    }
  );
  handle(
    CHANNELS.fieldsReveal,
    (itemId, name) => service2.current().revealField(assertString(itemId), assertString(name))
  );
  handle(CHANNELS.fieldsRemove, async (itemId, name) => {
    await service2.current().deleteField(assertString(itemId), assertString(name));
    service2.scheduleSave();
  });
  handle(CHANNELS.totpCode, (itemId) => service2.totpEntry(assertString(itemId)));
  handle(CHANNELS.totpList, () => service2.totpList());
  handle(CHANNELS.totpImportUri, async (uri) => {
    const parsed = parseOtpauthUri(assertString(uri));
    const title = parsed.issuer ? `${parsed.issuer} (${parsed.label})` : parsed.label;
    const vault2 = service2.current();
    const item = await vault2.createItem('totp', title);
    await vault2.setField(item.id, 'seed', 'totp_seed', parsed.secret);
    if (parsed.period !== 30) {
      await vault2.setField(item.id, 'period', 'text', String(parsed.period), false);
    }
    service2.scheduleSave();
    return item;
  });
  handle(CHANNELS.foldersList, () => service2.current().listFolders());
  handle(CHANNELS.foldersCreate, async (name, parentId) => {
    const folder = await service2.current().createFolder(assertString(name), parentId);
    service2.scheduleSave();
    return folder;
  });
  handle(CHANNELS.foldersDelete, async (id) => {
    await service2.current().deleteFolder(assertString(id));
    service2.scheduleSave();
  });
  handle(CHANNELS.tagsList, (itemId) => service2.current().listTags(itemId));
  handle(CHANNELS.tagsAdd, async (itemId, name) => {
    await service2.current().tagItem(assertString(itemId), assertString(name));
    service2.scheduleSave();
  });
  handle(CHANNELS.tagsRemove, async (itemId, name) => {
    await service2.current().untagItem(assertString(itemId), assertString(name));
    service2.scheduleSave();
  });
  handle(CHANNELS.urlsList, (itemId) => service2.current().listUrls(assertString(itemId)));
  handle(CHANNELS.urlsAdd, async (itemId, url) => {
    await service2.current().addUrl(assertString(itemId), assertString(url));
    service2.scheduleSave();
  });
  handle(CHANNELS.auditLog, (itemId) => service2.current().auditLog(itemId));
  handle(CHANNELS.wbCreateWallet, (networks, words) => {
    const wordCount = WORD_COUNTS.includes(words) ? words : 24;
    return wallet.createWallet(assertStringArray(networks), wordCount);
  });
  handle(
    CHANNELS.wbDeriveAccounts,
    (mnemonic, networks) => wallet.deriveAccounts(assertString(mnemonic), assertStringArray(networks))
  );
  handle(
    CHANNELS.wbEncryptText,
    (plaintext, passphrase) => core.encryptToString(assertString(plaintext), assertString(passphrase))
  );
  handle(
    CHANNELS.wbDecryptText,
    (armored, passphrase) => core.decryptFromString(assertString(armored), assertString(passphrase))
  );
  handle(
    CHANNELS.wbLegacyDecrypt,
    (ciphertext, salt) => legacy.decrypt(assertString(salt), assertString(ciphertext))
  );
  handle(
    CHANNELS.wbShamirSplit,
    (secret, shares, threshold) => shamir.splitToStrings(assertString(secret), {
      shares: assertInt(shares, 2, 255),
      threshold: assertInt(threshold, 2, 255)
    })
  );
  handle(
    CHANNELS.wbShamirCombine,
    (shares) => shamir.combineToString(assertStringArray(shares))
  );
};
const assertString = (value) => {
  if (typeof value !== 'string') throw new Error('expected a string');
  return value;
};
const assertStringArray = (value) => {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error('expected an array of strings');
  }
  return value;
};
const assertInt = (value, min, max) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`expected an integer between ${min} and ${max}`);
  }
  return value;
};
const APP_NAME = 'dcrypt';
const vaultFilePath = () => appstash.resolve(appstash.appstash(APP_NAME, { ensure: true }), 'data', 'db') + path__namespace.sep + 'vault.dcrypt';
const vaultModulePath = () => {
  const candidates = [
    // packaged: bundled next to the app's resources
    path__namespace.join(process.resourcesPath ?? '', 'pgpm-modules', 'dcrypt-vault'),
    // dev: the workspace checkout
    path__namespace.resolve(__dirname, '../../../../pgpm-modules/dcrypt-vault'),
    path__namespace.resolve(__dirname, '../../../pgpm-modules/dcrypt-vault')
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(path__namespace.join(candidate, 'pgpm.plan'))) {
      return candidate;
    }
  }
  throw new Error('cannot locate the dcrypt-vault pgpm module');
};
class VaultService {
  vault = null;
  saveTimer = null;
  status() {
    const file = vaultFilePath();
    return {
      exists: fs.existsSync(file),
      unlocked: this.vault !== null && !this.vault.isLocked,
      file
    };
  }
  async unlock(passphrase) {
    if (this.vault && !this.vault.isLocked) return;
    this.vault = await vault.Vault.open({
      file: vaultFilePath(),
      passphrase,
      modulePath: vaultModulePath(),
      kdf: 'moderate'
    });
  }
  async lock() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.vault) {
      await this.vault.lock();
      this.vault = null;
    }
  }
  /** Debounced persistence after mutations. */
  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.current().save();
    }, 2e3);
  }
  current() {
    if (!this.vault || this.vault.isLocked) {
      throw new Error('vault is locked');
    }
    return this.vault;
  }
  async totpEntry(itemId, period = 30) {
    const vault2 = this.current();
    const item = await vault2.getItem(itemId);
    if (!item) throw new Error('item not found');
    const code = await vault2.totpCode(itemId, { period });
    const now = Math.floor(Date.now() / 1e3);
    return { item, code, period, remaining: period - now % period };
  }
  async totpList() {
    const vault2 = this.current();
    const items = await vault2.listItems({ kind: 'totp' });
    return Promise.all(items.map((item) => this.totpEntry(item.id)));
  }
}
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL;
const service = new VaultService();
const AUTO_LOCK_MINUTES = 10;
const lockAndNotify = async (window) => {
  await service.lock();
  if (window && !window.isDestroyed()) {
    window.webContents.send(CHANNELS.lockedEvent);
  }
};
const createWindow = () => {
  const window = new electron.BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path__namespace.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  });
  window.setContentProtection(true);
  window.once('ready-to-show', () => window.show());
  window.webContents.session.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false)
  );
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void electron.shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
    }
  });
  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL);
  } else {
    void window.loadFile(path__namespace.join(__dirname, '../renderer/index.html'));
  }
  return window;
};
let mainWindow = null;
let idleTimer = null;
const watchIdle = () => {
  idleTimer = setInterval(() => {
    if (electron.powerMonitor.getSystemIdleTime() >= AUTO_LOCK_MINUTES * 60) {
      void lockAndNotify(mainWindow);
    }
  }, 3e4);
};
electron.app.whenReady().then(() => {
  electron.session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    const allowed = url.startsWith('file://') || url.startsWith('devtools://') || DEV_SERVER_URL !== void 0 && url.startsWith(DEV_SERVER_URL) || DEV_SERVER_URL !== void 0 && url.startsWith('ws://localhost');
    callback({ cancel: !allowed });
  });
  registerIpc(service);
  mainWindow = createWindow();
  watchIdle();
  electron.powerMonitor.on('suspend', () => void lockAndNotify(mainWindow));
  electron.powerMonitor.on('lock-screen', () => void lockAndNotify(mainWindow));
  electron.app.on('activate', () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});
electron.app.on('window-all-closed', () => {
  void service.lock().finally(() => {
    if (process.platform !== 'darwin') electron.app.quit();
  });
});
electron.app.on('before-quit', () => {
  if (idleTimer) clearInterval(idleTimer);
  void service.lock();
});
