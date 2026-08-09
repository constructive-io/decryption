import { WrongPassphraseError } from '@decryption/core';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Vault } from '../src';

jest.setTimeout(120000);

const MODULE_PATH = path.resolve(__dirname, '../../../pgpm-modules/dcrypt-vault');
const FAST = { t: 1, m: 8192, p: 1 };
const PASSPHRASE = 'a rather long master passphrase';

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dcrypt-vault-'));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Vault', () => {
  it('initializes, stores, persists and reopens', async () => {
    const file = path.join(dir, 'vault.dcrypt');
    const vault = await Vault.open({ file, passphrase: PASSPHRASE, modulePath: MODULE_PATH, kdf: FAST });

    const item = await vault.createItem('login', 'GitHub');
    await vault.setField(item.id, 'username', 'username', 'octocat', false);
    await vault.setField(item.id, 'password', 'password', 'correct horse battery staple');
    await vault.addUrl(item.id, 'https://github.com');
    await vault.tagItem(item.id, 'work');

    const totp = await vault.createItem('totp', 'Example 2FA');
    await vault.setField(totp.id, 'seed', 'totp_seed', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(await vault.totpCode(totp.id)).toMatch(/^\d{6}$/);

    expect(await vault.revealField(item.id, 'password')).toBe('correct horse battery staple');
    expect((await vault.searchItems('github')).map((i) => i.id)).toContain(item.id);

    await vault.lock();
    expect(vault.isLocked).toBe(true);
    await expect(vault.listItems()).rejects.toThrow(/locked/);

    // the file on disk must not leak plaintext
    const raw = await fs.readFile(file);
    expect(raw.includes(Buffer.from('GitHub'))).toBe(false);
    expect(raw.includes(Buffer.from('octocat'))).toBe(false);

    const reopened = await Vault.open({ file, passphrase: PASSPHRASE, modulePath: MODULE_PATH, kdf: FAST });
    const items = await reopened.listItems();
    expect(items.map((i) => i.title).sort()).toEqual(['Example 2FA', 'GitHub']);
    const github = items.find((i) => i.title === 'GitHub')!;
    expect(await reopened.revealField(github.id, 'password')).toBe('correct horse battery staple');
    expect(await reopened.listUrls(github.id)).toEqual(['https://github.com']);
    expect((await reopened.listTags(github.id)).map((t) => t.name)).toEqual(['work']);
    const reopenedTotp = items.find((i) => i.title === 'Example 2FA')!;
    expect(await reopened.totpCode(reopenedTotp.id)).toMatch(/^\d{6}$/);
    await reopened.lock();
  });

  it('generates codes for keys containing NUL bytes', async () => {
    const file = path.join(dir, 'nul-seed.dcrypt');
    const vault = await Vault.open({ file, passphrase: PASSPHRASE, modulePath: MODULE_PATH, kdf: FAST });
    const item = await vault.createItem('totp', 'Zero Bytes');
    // decodes to sixteen 0x00 bytes, which cannot survive a text round-trip
    await vault.setField(item.id, 'seed', 'totp_seed', 'AAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(await vault.totpCode(item.id)).toMatch(/^\d{6}$/);
    await vault.lock();
  });

  it('rejects the wrong passphrase', async () => {
    const file = path.join(dir, 'wrong-pass.dcrypt');
    const vault = await Vault.open({ file, passphrase: PASSPHRASE, modulePath: MODULE_PATH, kdf: FAST });
    await vault.lock();
    await expect(
      Vault.open({ file, passphrase: 'not the passphrase', modulePath: MODULE_PATH, kdf: FAST })
    ).rejects.toThrow(WrongPassphraseError);
  });

  it('manages folders, favorites and trash', async () => {
    const file = path.join(dir, 'organize.dcrypt');
    const vault = await Vault.open({ file, passphrase: PASSPHRASE, modulePath: MODULE_PATH, kdf: FAST });

    const folder = await vault.createFolder('Work');
    const item = await vault.createItem('note', 'Meeting notes', folder.id);
    expect((await vault.listItems({ folderId: folder.id })).map((i) => i.id)).toEqual([item.id]);

    await vault.setFavorite(item.id, true);
    expect((await vault.getItem(item.id))!.favorite).toBe(true);

    await vault.trashItem(item.id);
    expect(await vault.listItems()).toHaveLength(0);
    expect((await vault.listItems({ trashed: true })).map((i) => i.id)).toEqual([item.id]);

    await vault.restoreItem(item.id);
    expect((await vault.listItems()).map((i) => i.id)).toEqual([item.id]);

    await vault.deleteItemForever(item.id);
    expect(await vault.getItem(item.id)).toBeNull();
    await vault.lock();
  });

  it('changes the passphrase and re-encrypts values', async () => {
    const file = path.join(dir, 'rotate.dcrypt');
    const vault = await Vault.open({ file, passphrase: PASSPHRASE, modulePath: MODULE_PATH, kdf: FAST });
    const item = await vault.createItem('login', 'Rotated');
    await vault.setField(item.id, 'password', 'password', 'old-secret');

    await vault.changePassphrase('the new master passphrase');
    expect(await vault.revealField(item.id, 'password')).toBe('old-secret');
    await vault.lock();

    await expect(
      Vault.open({ file, passphrase: PASSPHRASE, modulePath: MODULE_PATH, kdf: FAST })
    ).rejects.toThrow(WrongPassphraseError);

    const reopened = await Vault.open({
      file,
      passphrase: 'the new master passphrase',
      modulePath: MODULE_PATH,
      kdf: FAST,
    });
    const items = await reopened.listItems();
    expect(await reopened.revealField(items[0].id, 'password')).toBe('old-secret');
    await reopened.lock();
  });

  it('rebuilds the database and carries every row across', async () => {
    const file = path.join(dir, 'rebuild.dcrypt');
    const vault = await Vault.open({ file, passphrase: PASSPHRASE, modulePath: MODULE_PATH, kdf: FAST });

    const parent = await vault.createFolder('Personal');
    const child = await vault.createFolder('Banking', parent.id);
    const login = await vault.createItem('login', 'Bank', child.id);
    await vault.setField(login.id, 'username', 'username', 'dan', false);
    await vault.setField(login.id, 'password', 'password', 'correct horse battery staple');
    await vault.addUrl(login.id, 'https://bank.example');
    await vault.tagItem(login.id, 'money');
    await vault.setFavorite(login.id, true);
    const code = await vault.createItem('totp', 'Bank 2FA');
    const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    await vault.setField(code.id, 'seed', 'totp_seed', seed);

    // the rebuild asserts the fresh database really carries the deployed schema,
    // so this passing at all rules out a deploy that quietly did nothing
    await vault.rebuild(MODULE_PATH);

    // same ids, same ciphertext, same passphrase — nothing was re-keyed
    expect((await vault.listItems()).map((item) => item.id).sort()).toEqual(
      [login.id, code.id].sort()
    );
    expect(await vault.revealField(login.id, 'password')).toBe('correct horse battery staple');
    expect(await vault.revealField(login.id, 'username')).toBe('dan');
    expect(await vault.listUrls(login.id)).toEqual(['https://bank.example']);
    expect((await vault.listTags(login.id)).map((tag) => tag.name)).toEqual(['money']);
    expect((await vault.getItem(login.id))!.favorite).toBe(true);
    expect((await vault.getItem(login.id))!.folderId).toBe(child.id);
    // the seed, not the code it produces: codes read either side of the rebuild
    // can straddle the 30s window and differ for reasons of clock, not of copy
    expect(await vault.revealField(code.id, 'seed')).toBe(seed);
    expect(await vault.totpCode(code.id)).toMatch(/^\d{6}$/);
    const folders = await vault.listFolders();
    expect(folders.find((folder) => folder.id === child.id)!.parentId).toBe(parent.id);

    await vault.lock();
    const reopened = await Vault.open({ file, passphrase: PASSPHRASE, modulePath: MODULE_PATH, kdf: FAST });
    expect(await reopened.revealField(login.id, 'password')).toBe('correct horse battery staple');
    await reopened.lock();
  });

  it('discards without persisting, for erase-all', async () => {
    const file = path.join(dir, 'discard.dcrypt');
    const vault = await Vault.open({ file, passphrase: PASSPHRASE, modulePath: MODULE_PATH, kdf: FAST });
    await vault.createItem('note', 'Written after the last save');
    await vault.discard();
    expect(vault.isLocked).toBe(true);

    const reopened = await Vault.open({ file, passphrase: PASSPHRASE, modulePath: MODULE_PATH, kdf: FAST });
    expect(await reopened.listItems()).toHaveLength(0);
    await reopened.lock();
  });

  it('records reveals in the audit log', async () => {
    const file = path.join(dir, 'audit.dcrypt');
    const vault = await Vault.open({ file, passphrase: PASSPHRASE, modulePath: MODULE_PATH, kdf: FAST });
    const item = await vault.createItem('login', 'Audited');
    await vault.setField(item.id, 'password', 'password', 'value');
    await vault.revealField(item.id, 'password');
    const log = await vault.auditLog(item.id);
    expect(log.map((entry) => entry.action)).toEqual(['reveal', 'set']);
    await vault.lock();
  });
});
