import { base64urlnopad } from '@decryption/base';
import { p256 } from '@decryption/curves/nist';
import { Vault } from '@decryption/vault';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { verifyAssertion } from '../src/authenticator';
import { PasskeyError, PasskeyStore } from '../src/store';

jest.setTimeout(120000);

const MODULE_PATH = path.resolve(__dirname, '../../../pgpm-modules/dcrypt-vault');
const FAST = { t: 1, m: 8192, p: 1 };
const PASSPHRASE = 'a rather long master passphrase';
const RP = { rpId: 'auth.example.com', origin: 'https://auth.example.com' };
const challenge = base64urlnopad.encode(Uint8Array.from({ length: 32 }, (_, i) => i));

let dir: string;
let vault: Vault;
let passkeys: PasskeyStore;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dcrypt-passkeys-'));
  vault = await Vault.open({
    file: path.join(dir, 'vault.dcrypt'),
    passphrase: PASSPHRASE,
    modulePath: MODULE_PATH,
    kdf: FAST,
  });
  passkeys = new PasskeyStore(vault);
});

afterAll(async () => {
  await vault.discard();
  await fs.rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const item of await vault.listItems({ kind: 'passkey' })) {
    await vault.deleteItemForever(item.id);
  }
});

const register = () => passkeys.register({ ...RP, challenge, userName: 'ci@example.com' });

describe('PasskeyStore', () => {
  it('keeps the private key concealed, and everything else readable', async () => {
    const { record } = await register();
    const fields = await vault.listFields(record.itemId);
    const concealed = fields.filter((field) => field.concealed).map((field) => field.name);

    expect(concealed).toEqual(['private_key']);
    expect(fields.map((field) => field.name).sort()).toEqual([
      'credential_id',
      'private_key',
      'rp_id',
      'sign_count',
      'user_handle',
      'user_name',
    ]);
  });

  it('signs with the key it stored', async () => {
    const { record, response } = await register();
    const publicKey = p256.getPublicKey(
      base64urlnopad.decode(await vault.revealField(record.itemId, 'private_key')),
      false
    );

    const assertion = await passkeys.assert(record.itemId, { ...RP, challenge });
    expect(assertion.id).toBe(response.id);
    expect(
      verifyAssertion(
        publicKey,
        base64urlnopad.decode(assertion.response.authenticatorData),
        base64urlnopad.decode(assertion.response.clientDataJSON),
        base64urlnopad.decode(assertion.response.signature)
      )
    ).toBe(true);
  });

  it('persists the sign count, so it advances across a lock', async () => {
    const { record } = await register();
    await passkeys.assert(record.itemId, { ...RP, challenge });
    await passkeys.assert(record.itemId, { ...RP, challenge });

    const [stored] = await passkeys.list();
    expect(stored.signCount).toBe(2);

    const authData = base64urlnopad.decode(
      (await passkeys.assert(record.itemId, { ...RP, challenge })).response.authenticatorData
    );
    expect(new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0)).toBe(3);
  });

  it('lists the keys for one site', async () => {
    await register();
    await passkeys.register({
      rpId: 'other.example.com',
      origin: 'https://other.example.com',
      challenge,
      userName: 'ci@example.com',
    });

    expect(await passkeys.list(RP.rpId)).toHaveLength(1);
    expect(await passkeys.list()).toHaveLength(2);
  });

  it('refuses to sign with something that is not a passkey', async () => {
    const note = await vault.createItem('note', 'not a passkey');
    await expect(passkeys.assert(note.id, { ...RP, challenge })).rejects.toThrow(PasskeyError);
  });

  it('forgets a key entirely', async () => {
    const { record } = await register();
    await passkeys.forget(record.itemId);
    expect(await passkeys.list()).toHaveLength(0);
    expect(await vault.getItem(record.itemId)).toBeNull();
  });
});
