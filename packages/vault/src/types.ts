export type ItemKind =
  | 'login'
  | 'note'
  | 'card'
  | 'identity'
  | 'wallet'
  | 'totp'
  | 'ssh_key';

export type FieldPurpose =
  | 'username'
  | 'password'
  | 'totp_seed'
  | 'mnemonic'
  | 'private_key'
  | 'text'
  | 'url';

export interface VaultItem {
  id: string;
  kind: ItemKind;
  title: string;
  folderId: string | null;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface VaultFieldMeta {
  id: string;
  itemId: string;
  name: string;
  purpose: FieldPurpose;
  concealed: boolean;
  updatedAt: string;
}

export interface VaultFolder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface VaultTag {
  id: string;
  name: string;
}

export interface AuditEntry {
  id: string;
  itemId: string | null;
  fieldName: string | null;
  action: string;
  occurredAt: string;
}

export interface TotpOptions {
  period?: number;
  digits?: number;
}
