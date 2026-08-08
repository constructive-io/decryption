import {
  decrypt,
  deriveEnvelopeKey,
  DerivedEnvelopeKey,
  encryptWithDerivedKey,
  KdfParams,
  KdfProfile,
} from '@decryption/core';
import { hkdf } from '@decryption/hashes/hkdf';
import { sha256 } from '@decryption/hashes/sha2';
import { bytesToHex, randomBytes, utf8ToBytes } from '@decryption/hashes/utils';
import { PGlite } from '@electric-sql/pglite';
import { PgpmPackage } from '@pgpmjs/core';
import { getEnvOptions } from '@pgpmjs/env';
import { registerPglite } from '@pgpmjs/pglite-adapter';
import { promises as fs } from 'fs';
import * as path from 'path';
import { teardownPgPools } from 'pg-cache';

import {
  AuditEntry,
  FieldPurpose,
  ItemKind,
  TotpOptions,
  VaultFieldMeta,
  VaultFolder,
  VaultItem,
  VaultTag,
} from './types';

// contrib extensions are exports-map-only, which node10 module resolution
// cannot type — resolve the CJS build at runtime instead
 
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');

const VAULT_SCHEMA = 'dcrypt_vault';

/** What a rebuild moved, so the UI can show that it was not a no-op. */
export interface RebuildReport {
  /** Tables in the freshly deployed schema that were copied through. */
  tables: number;
  /** Rows carried across, per table. */
  copied: Record<string, number>;
}

const DB_KEY_INFO = 'dcrypt/db-values';
const DB_KEY_SALT_META = 'db_key_salt';

export interface OpenVaultOptions {
  /** Path of the encrypted vault snapshot (created if missing). */
  file: string;
  /** Master passphrase; never persisted. */
  passphrase: string;
  /** Directory of the dcrypt-vault pgpm module, used to deploy a fresh vault. */
  modulePath: string;
  /** KDF cost for the snapshot envelope. */
  kdf?: KdfProfile | KdfParams;
}

interface ItemRow {
  id: string;
  kind: ItemKind;
  title: string;
  folder_id: string | null;
  favorite: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const toItem = (row: ItemRow): VaultItem => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  folderId: row.folder_id,
  favorite: row.favorite,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
});

/**
 * A passphrase-locked local vault. The database lives in memory (PGlite) and is
 * persisted as a single `@decryption/core` envelope around a gzipped pgdata
 * tarball, so the file on disk leaks nothing — not even item titles.
 */
export class Vault {
  private constructor(
    private db: PGlite | null,
    private snapshotKey: DerivedEnvelopeKey | null,
    private dbKey: string,
    private readonly file: string
  ) {}

  /** Open an existing vault file, or initialize a new one via pgpm deploy. */
  static async open(options: OpenVaultOptions): Promise<Vault> {
    const { file, passphrase, modulePath, kdf = 'moderate' } = options;

    let exists = true;
    try {
      await fs.access(file);
    } catch {
      exists = false;
    }

    let db: PGlite;
    if (exists) {
      const envelope = new Uint8Array(await fs.readFile(file));
      const tarball = decrypt(envelope, passphrase);
      db = await PGlite.create({
        loadDataDir: new Blob([tarball.slice().buffer as ArrayBuffer], {
          type: 'application/x-gzip',
        }),
        extensions: { pgcrypto },
      });
    } else {
      db = await Vault.deployFresh(modulePath);
      await db.query(
        'INSERT INTO dcrypt_vault.meta (key, value) VALUES ($1, $2)',
        [DB_KEY_SALT_META, bytesToHex(randomBytes(16))]
      );
    }

    const salt = await Vault.readDbKeySalt(db);
    const dbKey = deriveDbKey(passphrase, salt);
    // derive the snapshot key once: every later save costs only the AEAD pass,
    // so locking and autosave never block on Argon2id
    const vault = new Vault(db, deriveEnvelopeKey(passphrase, kdf), dbKey, file);
    if (!exists) {
      await vault.save();
    }
    return vault;
  }

  /** Runs `pgpm deploy` of the dcrypt-vault module into an empty PGlite. */
  private static async deployFresh(modulePath: string): Promise<PGlite> {
    const handle = await registerPglite({
      extensions: { pgcrypto },
      extensionSql: ['CREATE EXTENSION IF NOT EXISTS pgcrypto;'],
    });
    try {
      const proj = new PgpmPackage(modulePath);
      await proj.deploy(
        getEnvOptions({
          pg: { database: 'postgres' },
          deployment: { fast: true, usePlan: true, cache: false },
        }),
        proj.getModuleName()
      );
    } catch (error) {
      await teardownPgPools();
      await handle.close();
      throw error;
    }
    // evict the cached pool so the next open never reaches this instance
    await teardownPgPools();
    handle.unregister();
    await Vault.assertDeployed(handle.db as unknown as PGlite);
    // the adapter's PGlite type is resolved through the ESM declarations while
    // this CJS build resolves the CTS ones — identical runtime class
    return handle.db as unknown as PGlite;
  }

  /**
   * A deploy that decides it has nothing to do would leave an empty database
   * that then silently swallows a rebuild, so prove the schema is really there.
   */
  private static async assertDeployed(db: PGlite): Promise<void> {
    const wanted = COPY_ORDER.map((spec) => spec.table);
    const found = await db.query<{ tablename: string }>(
      'SELECT tablename FROM pg_tables WHERE schemaname = $1',
      [VAULT_SCHEMA]
    );
    const present = new Set(found.rows.map((row) => row.tablename));
    const missing = wanted.filter((table) => !present.has(table));
    if (missing.length > 0) {
      throw new Error(
        `pgpm deployed nothing usable: ${VAULT_SCHEMA} is missing ${missing.join(', ')}`
      );
    }
  }

  /**
   * Re-deploys the pgpm module into a fresh database and copies every row
   * across, so a vault created by an older module picks up schema changes.
   * Values move as ciphertext and the key salt is preserved, so no plaintext
   * is materialised and the master passphrase still opens the result.
   */
  async rebuild(modulePath: string): Promise<RebuildReport> {
    const old = this.database;
    const next = await Vault.deployFresh(modulePath);
    const copied: Record<string, number> = {};
    try {
      for (const spec of COPY_ORDER) {
        copied[spec.table] = await copyTable(old, next, spec);
      }
      // folders were inserted detached to satisfy their self-reference
      await reattachFolders(old, next);
    } catch (error) {
      await next.close();
      throw error;
    }
    this.db = next;
    await old.close();
    await this.save();
    return { tables: COPY_ORDER.length, copied };
  }

  private static async readDbKeySalt(db: PGlite): Promise<string> {
    const result = await db.query<{ value: string }>(
      'SELECT value FROM dcrypt_vault.meta WHERE key = $1',
      [DB_KEY_SALT_META]
    );
    if (!result.rows.length) {
      throw new Error('vault is missing its db key salt — the file may be corrupt');
    }
    return result.rows[0].value;
  }

  private get database(): PGlite {
    if (!this.db) {
      throw new Error('vault is locked');
    }
    return this.db;
  }

  get isLocked(): boolean {
    return this.db === null;
  }

  /** Encrypt the current database state to the vault file (atomic rename). */
  async save(): Promise<void> {
    if (!this.snapshotKey) throw new Error('vault is locked');
    const dump = await this.database.dumpDataDir('gzip');
    const tarball = new Uint8Array(await dump.arrayBuffer());
    const envelope = encryptWithDerivedKey(tarball, this.snapshotKey);
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(tmp, envelope, { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }

  /** Persist, close the database and drop key material from memory. */
  async lock(): Promise<void> {
    if (!this.db) return;
    await this.save();
    await this.discard();
  }

  /**
   * Close and forget the database *without* persisting it — for erasing the
   * vault, where writing the snapshot back out would be pointless or wrong.
   */
  async discard(): Promise<void> {
    if (!this.db) return;
    await this.db.close();
    this.db = null;
    this.snapshotKey?.key.fill(0);
    this.snapshotKey = null;
    this.dbKey = '';
  }

  // ─── items ────────────────────────────────────────────────────────────────

  async createItem(kind: ItemKind, title: string, folderId?: string): Promise<VaultItem> {
    const result = await this.database.query<ItemRow>(
      'INSERT INTO dcrypt_vault.items (kind, title, folder_id) VALUES ($1, $2, $3) RETURNING *',
      [kind, title, folderId ?? null]
    );
    return toItem(result.rows[0]);
  }

  async getItem(id: string): Promise<VaultItem | null> {
    const result = await this.database.query<ItemRow>(
      'SELECT * FROM dcrypt_vault.items WHERE id = $1',
      [id]
    );
    return result.rows.length ? toItem(result.rows[0]) : null;
  }

  async listItems(options: { kind?: ItemKind; folderId?: string; trashed?: boolean } = {}): Promise<VaultItem[]> {
    const clauses: string[] = [
      options.trashed ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL',
    ];
    const params: unknown[] = [];
    if (options.kind) {
      params.push(options.kind);
      clauses.push(`kind = $${params.length}`);
    }
    if (options.folderId) {
      params.push(options.folderId);
      clauses.push(`folder_id = $${params.length}`);
    }
    const result = await this.database.query<ItemRow>(
      `SELECT * FROM dcrypt_vault.items WHERE ${clauses.join(' AND ')} ORDER BY title`,
      params
    );
    return result.rows.map(toItem);
  }

  async renameItem(id: string, title: string): Promise<void> {
    await this.database.query('UPDATE dcrypt_vault.items SET title = $2 WHERE id = $1', [id, title]);
  }

  async setFavorite(id: string, favorite: boolean): Promise<void> {
    await this.database.query('UPDATE dcrypt_vault.items SET favorite = $2 WHERE id = $1', [
      id,
      favorite,
    ]);
  }

  async moveToFolder(id: string, folderId: string | null): Promise<void> {
    await this.database.query('UPDATE dcrypt_vault.items SET folder_id = $2 WHERE id = $1', [
      id,
      folderId,
    ]);
  }

  async trashItem(id: string): Promise<void> {
    await this.database.query('UPDATE dcrypt_vault.items SET deleted_at = now() WHERE id = $1', [id]);
  }

  async restoreItem(id: string): Promise<void> {
    await this.database.query('UPDATE dcrypt_vault.items SET deleted_at = NULL WHERE id = $1', [id]);
  }

  async deleteItemForever(id: string): Promise<void> {
    await this.database.query('DELETE FROM dcrypt_vault.items WHERE id = $1', [id]);
  }

  async searchItems(query: string): Promise<VaultItem[]> {
    const result = await this.database.query<ItemRow>(
      'SELECT * FROM dcrypt_vault.search_items($1)',
      [query]
    );
    return result.rows.map(toItem);
  }

  // ─── fields ───────────────────────────────────────────────────────────────

  async setField(
    itemId: string,
    name: string,
    purpose: FieldPurpose,
    value: string,
    concealed = true
  ): Promise<void> {
    await this.database.query('SELECT dcrypt_vault.set_field($1, $2, $3, $4, $5, $6)', [
      itemId,
      name,
      purpose,
      value,
      this.dbKey,
      concealed,
    ]);
  }

  async revealField(itemId: string, name: string): Promise<string> {
    const result = await this.database.query<{ v: string }>(
      'SELECT dcrypt_vault.reveal_field($1, $2, $3) AS v',
      [itemId, name, this.dbKey]
    );
    return result.rows[0].v;
  }

  async listFields(itemId: string): Promise<VaultFieldMeta[]> {
    const result = await this.database.query<{
      id: string;
      item_id: string;
      name: string;
      purpose: FieldPurpose;
      concealed: boolean;
      updated_at: string;
    }>(
      'SELECT id, item_id, name, purpose, concealed, updated_at FROM dcrypt_vault.fields WHERE item_id = $1 ORDER BY name',
      [itemId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      name: row.name,
      purpose: row.purpose,
      concealed: row.concealed,
      updatedAt: row.updated_at,
    }));
  }

  async deleteField(itemId: string, name: string): Promise<void> {
    await this.database.query('DELETE FROM dcrypt_vault.fields WHERE item_id = $1 AND name = $2', [
      itemId,
      name,
    ]);
  }

  // ─── totp ─────────────────────────────────────────────────────────────────

  async totpCode(itemId: string, options: TotpOptions = {}): Promise<string> {
    const result = await this.database.query<{ c: string }>(
      'SELECT dcrypt_vault.totp_code($1, $2, $3, $4) AS c',
      [itemId, this.dbKey, options.period ?? 30, options.digits ?? 6]
    );
    return result.rows[0].c;
  }

  // ─── folders / tags / urls ────────────────────────────────────────────────

  async createFolder(name: string, parentId?: string): Promise<VaultFolder> {
    const result = await this.database.query<{ id: string; name: string; parent_id: string | null }>(
      'INSERT INTO dcrypt_vault.folders (name, parent_id) VALUES ($1, $2) RETURNING id, name, parent_id',
      [name, parentId ?? null]
    );
    const row = result.rows[0];
    return { id: row.id, name: row.name, parentId: row.parent_id };
  }

  async listFolders(): Promise<VaultFolder[]> {
    const result = await this.database.query<{ id: string; name: string; parent_id: string | null }>(
      'SELECT id, name, parent_id FROM dcrypt_vault.folders ORDER BY name'
    );
    return result.rows.map((row) => ({ id: row.id, name: row.name, parentId: row.parent_id }));
  }

  async deleteFolder(id: string): Promise<void> {
    await this.database.query('DELETE FROM dcrypt_vault.folders WHERE id = $1', [id]);
  }

  async tagItem(itemId: string, tagName: string): Promise<void> {
    await this.database.query(
      `WITH tag AS (
         INSERT INTO dcrypt_vault.tags (name) VALUES ($2)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id
       )
       INSERT INTO dcrypt_vault.item_tags (item_id, tag_id)
       SELECT $1, tag.id FROM tag
       ON CONFLICT DO NOTHING`,
      [itemId, tagName]
    );
  }

  async untagItem(itemId: string, tagName: string): Promise<void> {
    await this.database.query(
      `DELETE FROM dcrypt_vault.item_tags it
       USING dcrypt_vault.tags t
       WHERE it.tag_id = t.id AND it.item_id = $1 AND t.name = $2`,
      [itemId, tagName]
    );
  }

  async listTags(itemId?: string): Promise<VaultTag[]> {
    const result = itemId
      ? await this.database.query<VaultTag>(
        `SELECT t.id, t.name FROM dcrypt_vault.tags t
           JOIN dcrypt_vault.item_tags it ON it.tag_id = t.id
           WHERE it.item_id = $1 ORDER BY t.name`,
        [itemId]
      )
      : await this.database.query<VaultTag>('SELECT id, name FROM dcrypt_vault.tags ORDER BY name');
    return result.rows;
  }

  async addUrl(itemId: string, url: string): Promise<void> {
    await this.database.query(
      'INSERT INTO dcrypt_vault.urls (item_id, url) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [itemId, url]
    );
  }

  async listUrls(itemId: string): Promise<string[]> {
    const result = await this.database.query<{ url: string }>(
      'SELECT url FROM dcrypt_vault.urls WHERE item_id = $1 ORDER BY url',
      [itemId]
    );
    return result.rows.map((row) => row.url);
  }

  // ─── audit ────────────────────────────────────────────────────────────────

  async auditLog(itemId?: string): Promise<AuditEntry[]> {
    const result = itemId
      ? await this.database.query<{
        id: string;
        item_id: string | null;
        field_name: string | null;
        action: string;
        occurred_at: string;
      }>(
        'SELECT * FROM dcrypt_vault.audit_log WHERE item_id = $1 ORDER BY occurred_at DESC',
        [itemId]
      )
      : await this.database.query<{
        id: string;
        item_id: string | null;
        field_name: string | null;
        action: string;
        occurred_at: string;
      }>('SELECT * FROM dcrypt_vault.audit_log ORDER BY occurred_at DESC');
    return result.rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      fieldName: row.field_name,
      action: row.action,
      occurredAt: row.occurred_at,
    }));
  }

  /** Change the master passphrase; re-derives the value key and re-encrypts every field. */
  async changePassphrase(next: string): Promise<void> {
    const db = this.database;
    const salt = bytesToHex(randomBytes(16));
    const nextKey = deriveDbKey(next, salt);
    await db.exec('BEGIN');
    try {
      await db.query(
        `UPDATE dcrypt_vault.fields
         SET value_enc = pgp_sym_encrypt(pgp_sym_decrypt(value_enc, $1), $2, 'compress-algo=1, cipher-algo=aes256')`,
        [this.dbKey, nextKey]
      );
      await db.query(
        `UPDATE dcrypt_vault.password_history
         SET value_enc = pgp_sym_encrypt(pgp_sym_decrypt(value_enc, $1), $2, 'compress-algo=1, cipher-algo=aes256')`,
        [this.dbKey, nextKey]
      );
      await db.query('UPDATE dcrypt_vault.meta SET value = $2 WHERE key = $1', [
        DB_KEY_SALT_META,
        salt,
      ]);
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
    this.snapshotKey?.key.fill(0);
    this.snapshotKey = deriveEnvelopeKey(next, this.snapshotKey?.kdf ?? 'moderate');
    this.dbKey = nextKey;
    await this.save();
  }
}

interface CopySpec {
  table: string;
  columns: string[];
  /** bytea columns, moved as hex so ciphertext survives the round trip. */
  binary?: string[];
  /** Enum columns, read as text and cast back on insert. */
  casts?: Record<string, string>;
  /** Columns forced to null on insert, set in a second pass. */
  detach?: string[];
  onConflict?: string;
}

/** Every table a vault owns, ordered so foreign keys are satisfied as we go. */
const COPY_ORDER: CopySpec[] = [
  { table: 'meta', columns: ['key', 'value'], onConflict: '(key) DO UPDATE SET value = EXCLUDED.value' },
  {
    table: 'folders',
    columns: ['id', 'name', 'parent_id', 'created_at'],
    detach: ['parent_id'],
  },
  {
    table: 'items',
    columns: [
      'id',
      'kind',
      'title',
      'folder_id',
      'favorite',
      'created_at',
      'updated_at',
      'deleted_at',
    ],
    casts: { kind: 'dcrypt_vault.item_kind' },
  },
  {
    table: 'fields',
    columns: [
      'id',
      'item_id',
      'name',
      'purpose',
      'value_enc',
      'concealed',
      'created_at',
      'updated_at',
    ],
    binary: ['value_enc'],
    casts: { purpose: 'dcrypt_vault.field_purpose' },
  },
  {
    table: 'password_history',
    columns: ['id', 'field_id', 'value_enc', 'replaced_at'],
    binary: ['value_enc'],
  },
  { table: 'tags', columns: ['id', 'name'], onConflict: '(name) DO NOTHING' },
  { table: 'item_tags', columns: ['item_id', 'tag_id'], onConflict: 'DO NOTHING' },
  { table: 'urls', columns: ['id', 'item_id', 'url'], onConflict: 'DO NOTHING' },
  {
    table: 'audit_log',
    columns: ['id', 'item_id', 'field_name', 'action', 'occurred_at'],
  },
];

const copyTable = async (from: PGlite, to: PGlite, spec: CopySpec): Promise<number> => {
  const binary = new Set(spec.binary ?? []);
  const detached = new Set(spec.detach ?? []);
  const selected = spec.columns
    .map((column) => {
      if (binary.has(column)) return `encode(${column}, 'hex') AS ${column}`;
      if (spec.casts?.[column]) return `${column}::text AS ${column}`;
      return column;
    })
    .join(', ');
  const rows = await from.query<Record<string, unknown>>(
    `SELECT ${selected} FROM dcrypt_vault.${spec.table}`
  );
  if (!rows.rows.length) return 0;

  const placeholders = spec.columns
    .map((column, index) => {
      const slot = `$${index + 1}`;
      if (binary.has(column)) return `decode(${slot}, 'hex')`;
      const cast = spec.casts?.[column];
      return cast ? `${slot}::${cast}` : slot;
    })
    .join(', ');
  const conflict = spec.onConflict ? ` ON CONFLICT ${spec.onConflict}` : '';
  const sql = `INSERT INTO dcrypt_vault.${spec.table} (${spec.columns.join(', ')}) VALUES (${placeholders})${conflict}`;
  for (const row of rows.rows) {
    await to.query(
      sql,
      spec.columns.map((column) => (detached.has(column) ? null : (row[column] ?? null)))
    );
  }
  return rows.rows.length;
};

/** Second pass for folders, whose parent may be inserted after the child. */
const reattachFolders = async (from: PGlite, to: PGlite): Promise<void> => {
  const rows = await from.query<{ id: string; parent_id: string | null }>(
    'SELECT id, parent_id FROM dcrypt_vault.folders WHERE parent_id IS NOT NULL'
  );
  for (const row of rows.rows) {
    await to.query('UPDATE dcrypt_vault.folders SET parent_id = $2 WHERE id = $1', [
      row.id,
      row.parent_id,
    ]);
  }
};

/** Derive the per-value encryption key from the master passphrase. */
export const deriveDbKey = (passphrase: string, saltHex: string): string =>
  bytesToHex(hkdf(sha256, utf8ToBytes(passphrase), utf8ToBytes(saltHex), utf8ToBytes(DB_KEY_INFO), 32));
