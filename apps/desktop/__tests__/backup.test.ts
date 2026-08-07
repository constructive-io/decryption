import { encrypt } from '@decryption/core';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

import { assertEnvelope, backupName } from '../src/main/backup';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dcrypt-backup-'));

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('backupName', () => {
  it('stamps the file so copies sort chronologically', () => {
    expect(backupName(new Date(2026, 7, 7, 14, 3))).toBe('dcrypt-vault-2026-08-07-1403.dcrypt');
  });
});

describe('assertEnvelope', () => {
  it('accepts a dcrypt envelope', async () => {
    const file = path.join(dir, 'good.dcrypt');
    await fs.writeFile(file, encrypt(new TextEncoder().encode('vault'), 'pw', 'interactive'));
    await expect(assertEnvelope(file)).resolves.toBeUndefined();
  }, 30_000);

  it('refuses to restore anything that is not one', async () => {
    const file = path.join(dir, 'holiday.jpg');
    await fs.writeFile(file, Buffer.alloc(512, 7));
    await expect(assertEnvelope(file)).rejects.toThrow(/not a dcrypt envelope/);
  });
});
