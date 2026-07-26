import { getConnections, PgTestClient } from 'pglite-test';

// contrib extensions are exports-map-only, which node10 module resolution
// cannot type — resolve the CJS build at runtime instead
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');

let db: PgTestClient;
let pg: PgTestClient;
let teardown: () => Promise<void>;

const KEY = 'session-key-for-tests';

beforeAll(async () => {
  ({ pg, db, teardown } = await getConnections({
    pglite: {
      extensions: { pgcrypto },
      extensionSql: ['CREATE EXTENSION IF NOT EXISTS pgcrypto;'],
    },
  }));
});

afterAll(async () => {
  await teardown();
});

beforeEach(async () => {
  await db.beforeEach();
});

afterEach(async () => {
  await db.afterEach();
});

const createItem = async (kind: string, title: string): Promise<string> => {
  const result = await pg.query<{ id: string }>(
    'INSERT INTO dcrypt_vault.items (kind, title) VALUES ($1, $2) RETURNING id',
    [kind, title]
  );
  return result.rows[0].id;
};

describe('schema', () => {
  it('deploys every table', async () => {
    const result = await pg.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'dcrypt_vault' ORDER BY table_name`
    );
    expect(result.rows.map((r: { table_name: string }) => r.table_name)).toEqual([
      'audit_log',
      'fields',
      'folders',
      'item_tags',
      'items',
      'meta',
      'password_history',
      'tags',
      'urls',
    ]);
  });
});

describe('fields', () => {
  it('stores values encrypted and reveals them with the key', async () => {
    const itemId = await createItem('login', 'GitHub');
    await pg.query('SELECT dcrypt_vault.set_field($1, $2, $3, $4, $5)', [
      itemId,
      'password',
      'password',
      'hunter2-but-long',
      KEY,
    ]);

    const raw = await pg.query<{ value_enc: Buffer; hit: boolean }>(
      `SELECT value_enc, position($1::bytea in value_enc) > 0 AS hit
       FROM dcrypt_vault.fields WHERE item_id = $2`,
      [Buffer.from('hunter2-but-long'), itemId]
    );
    expect(raw.rows[0].hit).toBe(false);

    const revealed = await pg.query<{ v: string }>(
      'SELECT dcrypt_vault.reveal_field($1, $2, $3) AS v',
      [itemId, 'password', KEY]
    );
    expect(revealed.rows[0].v).toBe('hunter2-but-long');
  });

  it('fails to reveal with the wrong key', async () => {
    const itemId = await createItem('login', 'GitLab');
    await pg.query('SELECT dcrypt_vault.set_field($1, $2, $3, $4, $5)', [
      itemId,
      'password',
      'password',
      'correct horse',
      KEY,
    ]);
    await expect(
      pg.query('SELECT dcrypt_vault.reveal_field($1, $2, $3)', [itemId, 'password', 'wrong-key'])
    ).rejects.toThrow(/Wrong key|decrypt/i);
  });

  it('rejects an empty session key', async () => {
    const itemId = await createItem('note', 'Empty key');
    await expect(
      pg.query('SELECT dcrypt_vault.set_field($1, $2, $3, $4, $5)', [
        itemId,
        'note',
        'text',
        'value',
        '',
      ])
    ).rejects.toThrow(/non-empty session key/);
  });

  it('captures password history on update', async () => {
    const itemId = await createItem('login', 'Rotated');
    await pg.query('SELECT dcrypt_vault.set_field($1, $2, $3, $4, $5)', [
      itemId,
      'password',
      'password',
      'old-password',
      KEY,
    ]);
    await pg.query('SELECT dcrypt_vault.set_field($1, $2, $3, $4, $5)', [
      itemId,
      'password',
      'password',
      'new-password',
      KEY,
    ]);

    const history = await pg.query<{ v: string }>(
      `SELECT pgp_sym_decrypt(h.value_enc, $1) AS v
       FROM dcrypt_vault.password_history h
       JOIN dcrypt_vault.fields f ON f.id = h.field_id
       WHERE f.item_id = $2`,
      [KEY, itemId]
    );
    expect(history.rows.map((r: { v: string }) => r.v)).toEqual(['old-password']);

    const current = await pg.query<{ v: string }>(
      'SELECT dcrypt_vault.reveal_field($1, $2, $3) AS v',
      [itemId, 'password', KEY]
    );
    expect(current.rows[0].v).toBe('new-password');
  });
});

describe('audit log', () => {
  it('records sets and reveals, never values', async () => {
    const itemId = await createItem('login', 'Audited');
    await pg.query('SELECT dcrypt_vault.set_field($1, $2, $3, $4, $5)', [
      itemId,
      'password',
      'password',
      'audited-value',
      KEY,
    ]);
    await pg.query('SELECT dcrypt_vault.reveal_field($1, $2, $3)', [itemId, 'password', KEY]);

    const log = await pg.query<{ action: string; field_name: string }>(
      'SELECT action, field_name FROM dcrypt_vault.audit_log WHERE item_id = $1 ORDER BY occurred_at',
      [itemId]
    );
    expect(log.rows.map((r: { action: string }) => r.action)).toEqual(['set', 'reveal']);
    const dump = JSON.stringify(log.rows);
    expect(dump).not.toContain('audited-value');
  });
});

describe('totp', () => {
  it('generates a verifiable code from an encrypted seed', async () => {
    const itemId = await createItem('totp', 'Example 2FA');
    await pg.query('SELECT dcrypt_vault.set_field($1, $2, $3, $4, $5)', [
      itemId,
      'seed',
      'totp_seed',
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      KEY,
    ]);

    const code = await pg.query<{ c: string }>(
      'SELECT dcrypt_vault.totp_code($1, $2) AS c',
      [itemId, KEY]
    );
    expect(code.rows[0].c).toMatch(/^\d{6}$/);

    const verified = await pg.query<{ ok: boolean }>('SELECT totp.verify($1, $2) AS ok', [
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      code.rows[0].c,
    ]);
    expect(verified.rows[0].ok).toBe(true);
  });
});

describe('search', () => {
  it('matches titles, urls and tags without decrypting', async () => {
    const itemId = await createItem('login', 'Cloud Console');
    await pg.query('INSERT INTO dcrypt_vault.urls (item_id, url) VALUES ($1, $2)', [
      itemId,
      'https://console.example.com',
    ]);
    const tag = await pg.query<{ id: string }>(
      "INSERT INTO dcrypt_vault.tags (name) VALUES ('work') RETURNING id"
    );
    await pg.query('INSERT INTO dcrypt_vault.item_tags (item_id, tag_id) VALUES ($1, $2)', [
      itemId,
      tag.rows[0].id,
    ]);

    for (const q of ['cloud', 'console.example', 'work']) {
      const hits = await pg.query<{ id: string }>(
        'SELECT id FROM dcrypt_vault.search_items($1)',
        [q]
      );
      expect(hits.rows.map((r: { id: string }) => r.id)).toContain(itemId);
    }

    const soft = await pg.query('UPDATE dcrypt_vault.items SET deleted_at = now() WHERE id = $1', [
      itemId,
    ]);
    expect(soft).toBeDefined();
    const gone = await pg.query<{ id: string }>(
      'SELECT id FROM dcrypt_vault.search_items($1)',
      ['cloud']
    );
    expect(gone.rows.map((r: { id: string }) => r.id)).not.toContain(itemId);
  });
});

describe('housekeeping', () => {
  it('touches updated_at on item update', async () => {
    const itemId = await createItem('note', 'Timestamps');
    const before = await pg.query<{ updated_at: string }>(
      'SELECT updated_at FROM dcrypt_vault.items WHERE id = $1',
      [itemId]
    );
    await pg.query('SELECT pg_sleep(0.01)');
    await pg.query("UPDATE dcrypt_vault.items SET title = 'Renamed' WHERE id = $1", [itemId]);
    const after = await pg.query<{ updated_at: string }>(
      'SELECT updated_at FROM dcrypt_vault.items WHERE id = $1',
      [itemId]
    );
    expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0].updated_at).getTime()
    );
  });

  it('cascades field deletion when an item is hard-deleted', async () => {
    const itemId = await createItem('login', 'Cascade');
    await pg.query('SELECT dcrypt_vault.set_field($1, $2, $3, $4, $5)', [
      itemId,
      'password',
      'password',
      'to-be-deleted',
      KEY,
    ]);
    await pg.query('DELETE FROM dcrypt_vault.items WHERE id = $1', [itemId]);
    const fields = await pg.query('SELECT id FROM dcrypt_vault.fields WHERE item_id = $1', [
      itemId,
    ]);
    expect(fields.rows).toHaveLength(0);
  });
});
