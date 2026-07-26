import type {
  AuditEntry,
  FieldPurpose,
  ItemKind,
  VaultFieldMeta,
  VaultFolder,
  VaultItem,
  VaultTag,
} from '@decryption/vault';

export type {
  AuditEntry,
  FieldPurpose,
  ItemKind,
  VaultFieldMeta,
  VaultFolder,
  VaultItem,
  VaultTag,
};

export interface VaultStatus {
  exists: boolean;
  unlocked: boolean;
  file: string;
}

export interface WalletAccountInfo {
  network: string;
  path: string;
  address: string;
  publicKey: string;
}

export interface WalletResult {
  mnemonic: string;
  accounts: WalletAccountInfo[];
}

export interface TotpEntry {
  item: VaultItem;
  code: string;
  period: number;
  /** Seconds until the current code rolls over. */
  remaining: number;
}

/**
 * The complete surface the renderer can reach. Everything crosses the context
 * bridge as plain JSON; secrets flow through only as explicit call results,
 * never as broadcast events.
 */
export interface DcryptApi {
  vault: {
    status(): Promise<VaultStatus>;
    unlock(passphrase: string): Promise<void>;
    lock(): Promise<void>;
    save(): Promise<void>;
    changePassphrase(next: string): Promise<void>;
  };
  items: {
    list(options?: { kind?: ItemKind; folderId?: string; trashed?: boolean }): Promise<VaultItem[]>;
    get(id: string): Promise<VaultItem | null>;
    create(kind: ItemKind, title: string, folderId?: string): Promise<VaultItem>;
    rename(id: string, title: string): Promise<void>;
    favorite(id: string, favorite: boolean): Promise<void>;
    move(id: string, folderId: string | null): Promise<void>;
    trash(id: string): Promise<void>;
    restore(id: string): Promise<void>;
    destroy(id: string): Promise<void>;
    search(query: string): Promise<VaultItem[]>;
  };
  fields: {
    list(itemId: string): Promise<VaultFieldMeta[]>;
    set(
      itemId: string,
      name: string,
      purpose: FieldPurpose,
      value: string,
      concealed?: boolean
    ): Promise<void>;
    reveal(itemId: string, name: string): Promise<string>;
    remove(itemId: string, name: string): Promise<void>;
  };
  totp: {
    code(itemId: string): Promise<TotpEntry>;
    list(): Promise<TotpEntry[]>;
    importUri(uri: string): Promise<VaultItem>;
  };
  organize: {
    folders(): Promise<VaultFolder[]>;
    createFolder(name: string, parentId?: string): Promise<VaultFolder>;
    deleteFolder(id: string): Promise<void>;
    tags(itemId?: string): Promise<VaultTag[]>;
    tag(itemId: string, name: string): Promise<void>;
    untag(itemId: string, name: string): Promise<void>;
    urls(itemId: string): Promise<string[]>;
    addUrl(itemId: string, url: string): Promise<void>;
  };
  audit: {
    log(itemId?: string): Promise<AuditEntry[]>;
  };
  workbench: {
    createWallet(networks: string[], words: number): Promise<WalletResult>;
    deriveAccounts(mnemonic: string, networks: string[]): Promise<WalletAccountInfo[]>;
    encryptText(plaintext: string, passphrase: string): Promise<string>;
    decryptText(armored: string, passphrase: string): Promise<string>;
    legacyDecrypt(ciphertext: string, salt: string): Promise<string>;
    shamirSplit(secret: string, shares: number, threshold: number): Promise<string[]>;
    shamirCombine(shares: string[]): Promise<string>;
  };
}

export const CHANNELS = {
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
  lockedEvent: 'vault:locked-event',
} as const;
