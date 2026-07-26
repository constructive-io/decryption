import { bytesToHex, hexToBytes } from '@decryption/hashes/utils';

import { entropyToMnemonic, generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '../src';
import { wordlist } from '../src/wordlists/english';

const TREZOR_MNEMONIC =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';

describe('@decryption/bip39', () => {
  it('matches the Trezor BIP39 vector', () => {
    expect(entropyToMnemonic(hexToBytes('7f'.repeat(16)), wordlist)).toBe(TREZOR_MNEMONIC);
    expect(bytesToHex(mnemonicToSeedSync(TREZOR_MNEMONIC, 'TREZOR'))).toBe(
      '2e8905819b8723fe2c1d161860e5ee1830318dbf49a83bd451cfb8440c28bd6f' +
        'a457fe1296106559a3c80937a1c1069be3a3a5bd381ee6260e8d9739fce1f607'
    );
  });

  it('validates and rejects mnemonics by checksum', () => {
    expect(validateMnemonic(TREZOR_MNEMONIC, wordlist)).toBe(true);
    expect(validateMnemonic(TREZOR_MNEMONIC.replace('yellow', 'zoo'), wordlist)).toBe(false);
  });

  it('generates 12- and 24-word mnemonics', () => {
    expect(generateMnemonic(wordlist, 128).split(' ')).toHaveLength(12);
    expect(generateMnemonic(wordlist, 256).split(' ')).toHaveLength(24);
  });
});
