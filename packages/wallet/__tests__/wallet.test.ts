import {
  assertValidMnemonic,
  bytesToMnemonic,
  convertBech32Prefix,
  createMnemonic,
  createWallet,
  defineNetwork,
  derivationPath,
  deriveAccount,
  deriveAccounts,
  derivePrivateKey,
  isValidAddress,
  isValidMnemonic,
  MnemonicError,
  mnemonicToBytes,
  NETWORKS,
  normalizeMnemonic,
  publicKeyToAddress,
} from '../src';

/** The canonical BIP39 all-zero-entropy mnemonic. */
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('mnemonics', () => {
  it('generates every permitted word count', () => {
    for (const words of [12, 15, 18, 21, 24] as const) {
      const mnemonic = createMnemonic(words);
      expect(mnemonic.split(' ')).toHaveLength(words);
      expect(isValidMnemonic(mnemonic)).toBe(true);
    }
  });

  it('rejects unsupported word counts', () => {
    expect(() => createMnemonic(13 as never)).toThrow(MnemonicError);
  });

  it('normalizes casing and whitespace', () => {
    expect(normalizeMnemonic('  ABANDON   abandon\nABOUT ')).toBe('abandon abandon about');
    expect(isValidMnemonic(MNEMONIC.toUpperCase())).toBe(true);
  });

  it('names the actual validation failure', () => {
    expect(() => assertValidMnemonic('abandon abandon about')).toThrow(/expected 12/);
    expect(() => assertValidMnemonic(MNEMONIC.replace('about', 'notaword'))).toThrow(
      /not in the wordlist: notaword/
    );
    expect(() => assertValidMnemonic(MNEMONIC.replace('about', 'zoo'))).toThrow(/checksum/);
  });

  it('round-trips entropy', () => {
    expect(mnemonicToBytes(MNEMONIC)).toEqual(new Uint8Array(16));
    expect(bytesToMnemonic(new Uint8Array(16))).toBe(MNEMONIC);
  });
});

describe('address derivation', () => {
  it('matches cosmjs for cosmos-family chains', () => {
    expect(deriveAccount(MNEMONIC, 'cosmoshub').address).toBe(
      'cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4'
    );
    expect(deriveAccount(MNEMONIC, 'osmosis').address).toBe(
      'osmo19rl4cm2hmr8afy4kldpxz3fka4jguq0a5m7df8'
    );
  });

  it('matches the well-known EIP-55 address for the test mnemonic', () => {
    expect(deriveAccount(MNEMONIC, 'ethereum').address).toBe(
      '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'
    );
  });

  it('matches the BIP84 vector for bitcoin', () => {
    expect(deriveAccount(MNEMONIC, 'bitcoin', { path: "m/84'/0'/0'/0/0" }).address).toBe(
      'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'
    );
  });

  it('uses the SLIP-44 coin type of each network', () => {
    expect(deriveAccount(MNEMONIC, 'cosmoshub').path).toBe("m/44'/118'/0'/0/0");
    expect(deriveAccount(MNEMONIC, 'secret').path).toBe("m/44'/529'/0'/0/0");
    expect(derivationPath(NETWORKS.ethereum, { account: 2, index: 5 })).toBe("m/44'/60'/2'/0/5");
  });

  it('derives distinct addresses per account and index', () => {
    const addresses = new Set(
      [0, 1, 2].map((index) => deriveAccount(MNEMONIC, 'cosmoshub', { index }).address)
    );
    expect(addresses.size).toBe(3);
  });

  it('honours the BIP39 passphrase', () => {
    expect(deriveAccount(MNEMONIC, 'cosmoshub', { passphrase: 'x' }).address).not.toBe(
      deriveAccount(MNEMONIC, 'cosmoshub').address
    );
  });

  it('supports custom cosmos-family networks', () => {
    const dydx = defineNetwork({
      id: 'dydx',
      name: 'dYdX',
      coinType: 118,
      addressEncoding: 'bech32',
      prefix: 'dydx',
    });
    const account = deriveAccount(MNEMONIC, dydx);
    expect(account.address.startsWith('dydx1')).toBe(true);
    // same coin type as the hub, so only the prefix differs
    expect(convertBech32Prefix(deriveAccount(MNEMONIC, 'cosmoshub').address, 'dydx')).toBe(
      account.address
    );
  });

  it('rejects unknown networks by name', () => {
    expect(() => deriveAccount(MNEMONIC, 'notachain')).toThrow(/unknown network/);
  });

  it('encodes an address straight from a public key', () => {
    const { publicKey, address } = deriveAccount(MNEMONIC, 'cosmoshub');
    const bytes = Uint8Array.from(Buffer.from(publicKey, 'hex'));
    expect(publicKeyToAddress(bytes, 'cosmoshub')).toBe(address);
  });
});

describe('address validation', () => {
  it('accepts valid addresses and rejects the rest', () => {
    const cosmos = deriveAccount(MNEMONIC, 'cosmoshub').address;
    expect(isValidAddress(cosmos, 'cosmoshub')).toBe(true);
    expect(isValidAddress(cosmos, 'osmosis')).toBe(false);
    expect(isValidAddress(`${cosmos.slice(0, -1)}x`, 'cosmoshub')).toBe(false);
    expect(isValidAddress('0x9858EfFD232B4033E47d90003D41EC34EcaEda94', 'ethereum')).toBe(true);
    expect(isValidAddress('0x9858effd232b4033e47d90003d41ec34ecaeda94', 'ethereum')).toBe(true);
    expect(isValidAddress('0x9858EFFD232B4033E47d90003D41EC34EcaEda94', 'ethereum')).toBe(false);
    expect(isValidAddress('nonsense', 'ethereum')).toBe(false);
  });
});

describe('createWallet', () => {
  it('returns a fresh mnemonic with one account per network', () => {
    const { mnemonic, accounts } = createWallet(['cosmoshub', 'ethereum'], 12);
    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(accounts.map((a) => a.network)).toEqual(['cosmoshub', 'ethereum']);
    expect(deriveAccounts(mnemonic, ['cosmoshub'])[0].address).toBe(accounts[0].address);
  });
});

describe('private keys', () => {
  it('are only exposed when explicitly requested', () => {
    const account = deriveAccount(MNEMONIC, 'cosmoshub');
    expect(Object.keys(account)).toEqual(['network', 'path', 'address', 'publicKey']);
    const key = derivePrivateKey(MNEMONIC, 'cosmoshub');
    expect(key).toHaveLength(32);
    key.fill(0);
  });
});
