import { WrongPassphraseError } from '@decryption/core';
import { generateIdentity, KeyError, recipientToString } from '@decryption/keys';
import { ReconstructionError } from '@decryption/shamir';

import {
  addRecipient,
  canRead,
  createVault,
  deleteValue,
  exportValues,
  getValue,
  getValues,
  listKeys,
  parseDotenv,
  parseVault,
  recoverIdentity,
  removeRecipient,
  rotateFileKey,
  serializeVault,
  setValue,
  setValues,
  splitRecoveryIdentity,
  Vault,
  VaultError,
} from '../src';

const dan = generateIdentity();
const ada = generateIdentity();
const mallory = generateIdentity();

const asRecipient = (identity: typeof dan, label: string) => ({
  label,
  recipient: recipientToString(identity.publicKey),
});

const seeded = (): Vault =>
  setValues(createVault({ name: 'production', recipients: [asRecipient(dan, 'dan')] }), dan, {
    DATABASE_URL: 'postgres://user:pw@localhost:5432/db',
    STRIPE_KEY: 'sk_live_abc123',
  });

describe('values', () => {
  it('round-trips secrets', () => {
    const vault = seeded();
    expect(getValue(vault, dan, 'DATABASE_URL')).toBe('postgres://user:pw@localhost:5432/db');
    expect(getValues(vault, dan)).toEqual({
      DATABASE_URL: 'postgres://user:pw@localhost:5432/db',
      STRIPE_KEY: 'sk_live_abc123',
    });
  });

  it('lists names without needing a key, and never stores plaintext', () => {
    const vault = seeded();
    expect(listKeys(vault)).toEqual(['DATABASE_URL', 'STRIPE_KEY']);
    expect(serializeVault(vault)).not.toContain('sk_live_abc123');
  });

  it('is immutable: setValue returns a new vault', () => {
    const vault = seeded();
    const updated = setValue(vault, dan, 'NEW', 'value');
    expect(listKeys(vault)).not.toContain('NEW');
    expect(getValue(updated, dan, 'NEW')).toBe('value');
  });

  it('overwrites and deletes', () => {
    let vault = setValue(seeded(), dan, 'STRIPE_KEY', 'sk_live_rotated');
    expect(getValue(vault, dan, 'STRIPE_KEY')).toBe('sk_live_rotated');
    vault = deleteValue(vault, 'STRIPE_KEY');
    expect(listKeys(vault)).toEqual(['DATABASE_URL']);
    expect(() => getValue(vault, dan, 'STRIPE_KEY')).toThrow(VaultError);
    expect(() => deleteValue(vault, 'STRIPE_KEY')).toThrow(VaultError);
  });

  it('binds each ciphertext to its own name', () => {
    const vault = seeded();
    const swapped: Vault = {
      ...vault,
      values: { ...vault.values, DATABASE_URL: vault.values.STRIPE_KEY },
    };
    expect(() => getValue(swapped, dan, 'DATABASE_URL')).toThrow(WrongPassphraseError);
  });

  it('keeps non-recipients out', () => {
    expect(canRead(seeded(), mallory)).toBe(false);
    expect(() => getValue(seeded(), mallory, 'STRIPE_KEY')).toThrow(KeyError);
  });
});

describe('recipients', () => {
  it('adds a teammate and rekeys', () => {
    const before = seeded();
    const after = addRecipient(before, dan, asRecipient(ada, 'ada'));
    expect(getValue(after, ada, 'STRIPE_KEY')).toBe('sk_live_abc123');
    expect(getValue(after, dan, 'STRIPE_KEY')).toBe('sk_live_abc123');
    // rekeyed: the old file is not readable with the new stanzas and vice versa
    expect(after.values.STRIPE_KEY).not.toBe(before.values.STRIPE_KEY);
    expect(canRead(before, ada)).toBe(false);
  });

  it('removes a teammate and rekeys', () => {
    const shared = addRecipient(seeded(), dan, asRecipient(ada, 'ada'));
    const after = removeRecipient(shared, dan, 'ada');
    expect(canRead(after, ada)).toBe(false);
    expect(getValue(after, dan, 'DATABASE_URL')).toBe('postgres://user:pw@localhost:5432/db');
    expect(after.recipients.map((r) => r.label)).toEqual(['dan']);
  });

  it('refuses duplicates, unknown labels, self-removal and empty vaults', () => {
    const vault = seeded();
    expect(() => addRecipient(vault, dan, asRecipient(dan, 'dan-again'))).toThrow(VaultError);
    expect(() => removeRecipient(vault, dan, 'nobody')).toThrow(VaultError);
    expect(() => removeRecipient(vault, dan, 'dan')).toThrow(VaultError);
    expect(() => createVault({ name: 'x', recipients: [] })).toThrow(VaultError);
    expect(() =>
      createVault({ name: 'x', recipients: [{ label: 'bad', recipient: 'not-a-recipient' }] })
    ).toThrow();
  });

  it('rotates the file key on demand', () => {
    const before = seeded();
    const after = rotateFileKey(before, dan);
    expect(after.values.DATABASE_URL).not.toBe(before.values.DATABASE_URL);
    expect(getValue(after, dan, 'DATABASE_URL')).toBe(getValue(before, dan, 'DATABASE_URL'));
  });
});

describe('serialization', () => {
  it('is deterministic and sorted', () => {
    const vault = seeded();
    const text = serializeVault(vault);
    expect(serializeVault(parseVault(text))).toBe(text);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.indexOf('DATABASE_URL')).toBeLessThan(text.indexOf('STRIPE_KEY'));
  });

  it('changing one secret changes one line', () => {
    const vault = seeded();
    const before = serializeVault(vault).split('\n');
    const after = serializeVault(setValue(vault, dan, 'STRIPE_KEY', 'sk_live_new')).split('\n');
    // the file key stanzas are stable across a plain setValue, so only the value line differs
    const changed = after.filter((line, i) => line !== before[i]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain('STRIPE_KEY');
  });

  it('rejects malformed files with an explanation', () => {
    expect(() => parseVault('nope')).toThrow(/not valid JSON/);
    expect(() => parseVault('[]')).toThrow(/JSON object/);
    expect(() => parseVault(JSON.stringify({ dcrypt: 99 }))).toThrow(/unsupported vault version/);
    expect(() => parseVault(JSON.stringify({ dcrypt: 1, name: 'x' }))).toThrow(/no recipients/);
    const vault = JSON.parse(serializeVault(seeded()));
    expect(() => parseVault(JSON.stringify({ ...vault, values: { A: 1 } }))).toThrow(
      /not a string/
    );
  });

  it('survives a full write/read cycle', () => {
    const restored = parseVault(serializeVault(seeded()));
    expect(getValue(restored, dan, 'STRIPE_KEY')).toBe('sk_live_abc123');
  });
});

describe('export', () => {
  const vault = setValue(seeded(), dan, 'MESSAGE', 'hello "world"\nsecond line');

  it('renders dotenv, shell, yaml and json', () => {
    expect(exportValues(vault, dan, 'dotenv')).toContain('STRIPE_KEY=sk_live_abc123');
    expect(exportValues(vault, dan, 'dotenv')).toContain(
      'MESSAGE="hello \\"world\\"\\nsecond line"'
    );
    expect(exportValues(vault, dan, 'shell')).toContain("export STRIPE_KEY='sk_live_abc123'");
    expect(exportValues(vault, dan, 'yaml')).toContain('STRIPE_KEY: "sk_live_abc123"');
    expect(JSON.parse(exportValues(vault, dan, 'json')).STRIPE_KEY).toBe('sk_live_abc123');
  });

  it('round-trips through dotenv', () => {
    const values = parseDotenv(exportValues(vault, dan, 'dotenv'));
    expect(values).toEqual(getValues(vault, dan));
  });

  it('imports messy .env files', () => {
    expect(
      parseDotenv(`
        # a comment
        export FOO=bar

        QUOTED='single'
        EMPTY=
        not a line
      `)
    ).toEqual({ FOO: 'bar', QUOTED: 'single', EMPTY: '' });
  });
});

describe('break-glass recovery', () => {
  it('restores a recovery identity from a threshold of shares', () => {
    const breakGlass = generateIdentity();
    const vault = addRecipient(seeded(), dan, asRecipient(breakGlass, 'break-glass'));
    const shares = splitRecoveryIdentity(breakGlass, { shares: 5, threshold: 3 });
    const restored = recoverIdentity([shares[4], shares[1], shares[0]]);
    expect(getValue(vault, restored, 'DATABASE_URL')).toBe('postgres://user:pw@localhost:5432/db');
  });

  it('fails loudly on a corrupted share', () => {
    const shares = splitRecoveryIdentity(generateIdentity(), { shares: 3, threshold: 2 });
    shares[0][25] ^= 0xff;
    expect(() => recoverIdentity([shares[0], shares[1]])).toThrow(ReconstructionError);
  });
});
