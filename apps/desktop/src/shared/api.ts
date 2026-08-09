import type { AccountRecord, ApiKeyRecord, StepUpProof } from '@decryption/accounts';
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
  AccountRecord,
  ApiKeyRecord,
  AuditEntry,
  FieldPurpose,
  ItemKind,
  StepUpProof,
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

/** What this machine can offer instead of typing the master password. */
export interface BiometricStatus {
  /** Whether the OS credential store can seal a secret at all. */
  available: boolean;
  /** Whether unlocking can be gated by a fingerprint (macOS Touch ID). */
  biometric: boolean;
  /** Whether a password is already remembered on this machine. */
  enrolled: boolean;
  /** What to call the store in the UI: "Keychain", "Credential Manager", … */
  store: string;
}

/** Where a backup was written, or which file was restored; null if cancelled. */
export interface BackupResult {
  path: string | null;
  /** For a restore, the copy kept of the vault that was replaced. */
  replaced?: string | null;
}

/**
 * A brand mark for an item, resolved from bundled sets: svgl's full-colour
 * logo markup where available, otherwise simple-icons' monochrome 24x24 path.
 */
export type BrandIcon =
  | { kind: 'logo'; title: string; slug: string; light: string; dark: string }
  | { kind: 'glyph'; title: string; slug: string; path: string; hex: string };

/** Credentials for a sign-in or sign-up; the password is used and discarded. */
export interface SignInRequest {
  endpoint: string;
  email: string;
  password: string;
}

export interface CreateKeyRequest {
  name: string;
  /** Lifetime in whole days; omitted means the server's default. */
  expiresDays?: number;
  accessLevel?: string;
}

/** What a rebuild carried across, so the UI can show it was not a no-op. */
export interface RebuildReport {
  tables: number;
  copied: Record<string, number>;
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
    /** Re-deploys the pgpm module into a fresh database, keeping every item. */
    rebuild(): Promise<RebuildReport>;
    /** Deletes the vault and every other file dcrypt keeps on this machine. */
    eraseAll(): Promise<void>;
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
    /** Null when the item carries no one-time-code seed. */
    code(itemId: string): Promise<TotpEntry | null>;
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
  accounts: {
    list(): Promise<AccountRecord[]>;
    signIn(request: SignInRequest): Promise<AccountRecord>;
    signUp(request: SignInRequest): Promise<AccountRecord>;
    signOut(itemId: string): Promise<void>;
    /** Removes the account and its keys from this vault, server side untouched. */
    forget(itemId: string): Promise<void>;
    keys(accountItemId?: string): Promise<ApiKeyRecord[]>;
    createKey(
      accountItemId: string,
      request: CreateKeyRequest,
      /** Supplied on a retry, after the server asked for a fresh factor. */
      stepUp?: StepUpProof
    ): Promise<ApiKeyRecord>;
    /** Reads the secret back out of the vault, on demand only. */
    revealKey(itemId: string): Promise<string>;
    revokeKey(itemId: string, stepUp?: StepUpProof): Promise<void>;
    /** Point an account at a vault code that then answers its MFA step-ups. */
    linkTotp(accountItemId: string, totpItemId: string): Promise<void>;
    unlinkTotp(accountItemId: string): Promise<void>;
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
  backup: {
    /** Copies the encrypted vault file to a location the user chooses. */
    create(): Promise<BackupResult>;
    /** Locks the vault and replaces it with a chosen backup. */
    restore(): Promise<BackupResult>;
    /** Opens the vault's folder in the system file manager. */
    revealVault(): Promise<void>;
  };
  unlockKey: {
    status(): Promise<BiometricStatus>;
    /** Remember the master password on this machine, sealed by the OS store. */
    enrol(passphrase: string): Promise<void>;
    forget(): Promise<void>;
    /** Unlock using the remembered password; false when none is remembered. */
    unlock(): Promise<boolean>;
  };
  clipboard: {
    /** Copy a secret, and clear it again after `seconds`. */
    copy(value: string, seconds?: number): Promise<void>;
  };
  icons: {
    lookup(names: string[]): Promise<Record<string, BrandIcon | null>>;
  };
  theme: {
    getSystemDark(): Promise<boolean>;
  };
}

export const CHANNELS = {
  vaultStatus: 'vault:status',
  vaultUnlock: 'vault:unlock',
  vaultLock: 'vault:lock',
  vaultSave: 'vault:save',
  vaultChangePassphrase: 'vault:change-passphrase',
  vaultRebuild: 'vault:rebuild',
  vaultEraseAll: 'vault:erase-all',
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
  accountsList: 'accounts:list',
  accountsSignIn: 'accounts:sign-in',
  accountsSignUp: 'accounts:sign-up',
  accountsSignOut: 'accounts:sign-out',
  accountsForget: 'accounts:forget',
  accountsKeys: 'accounts:keys',
  accountsCreateKey: 'accounts:create-key',
  accountsRevealKey: 'accounts:reveal-key',
  accountsRevokeKey: 'accounts:revoke-key',
  accountsLinkTotp: 'accounts:link-totp',
  accountsUnlinkTotp: 'accounts:unlink-totp',
  auditLog: 'audit:log',
  wbCreateWallet: 'workbench:create-wallet',
  wbDeriveAccounts: 'workbench:derive-accounts',
  wbEncryptText: 'workbench:encrypt-text',
  wbDecryptText: 'workbench:decrypt-text',
  wbLegacyDecrypt: 'workbench:legacy-decrypt',
  wbShamirSplit: 'workbench:shamir-split',
  wbShamirCombine: 'workbench:shamir-combine',
  backupCreate: 'backup:create',
  backupRestore: 'backup:restore',
  backupRevealVault: 'backup:reveal-vault',
  unlockKeyStatus: 'unlock-key:status',
  unlockKeyEnrol: 'unlock-key:enrol',
  unlockKeyForget: 'unlock-key:forget',
  unlockKeyUnlock: 'unlock-key:unlock',
  clipboardCopy: 'clipboard:copy',
  iconsLookup: 'icons:lookup',
  lockedEvent: 'vault:locked-event',
  themeGetSystemDark: 'theme:get-system-dark',
  themeSystemChanged: 'theme:system-changed',
} as const;
