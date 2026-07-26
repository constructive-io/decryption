import { hexToBytes } from '@decryption/hashes/utils';

import { HDKey } from '../src';

// BIP32 test vector 1: https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki
const SEED = hexToBytes('000102030405060708090a0b0c0d0e0f');

describe('@decryption/bip32', () => {
  it('derives the BIP32 test-vector-1 master key', () => {
    const hd = HDKey.fromMasterSeed(SEED);
    expect(hd.publicExtendedKey).toBe(
      'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'
    );
  });

  it("derives m/0'", () => {
    const hd = HDKey.fromMasterSeed(SEED).derive("m/0'");
    expect(hd.publicExtendedKey).toBe(
      'xpub68Gmy5EdvgibQVfPdqkBBCHxA5htiqg55crXYuXoQRKfDBFA1WEjWgP6LHhwBZeNK1VTsfTFUHCdrfp1bgwQ9xv5ski8PX9rL2dZXvgGDnw'
    );
  });
});
