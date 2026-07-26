import { bech32 } from '@decryption/base';
import { secp256k1 } from '@decryption/curves/secp256k1';
import { ripemd160 } from '@decryption/hashes/legacy';
import { keccak_256 } from '@decryption/hashes/sha3';
import { sha256 } from '@decryption/hashes/sha2';
import { bytesToHex } from '@decryption/hashes/utils';

import { Network, resolveNetwork } from './networks';

/**
 * Encodes a secp256k1 public key as an address for the given network. Pure computation — no
 * chain registry, no RPC.
 */
export const publicKeyToAddress = (publicKey: Uint8Array, network: string | Network): string => {
  const resolved = resolveNetwork(network);
  switch (resolved.addressEncoding) {
    case 'bech32':
      return bech32.encode(resolved.prefix!, bech32.toWords(cosmosHash(publicKey)));
    case 'p2wpkh':
      return bech32.encode(resolved.prefix!, [0, ...bech32.toWords(cosmosHash(publicKey))]);
    case 'evm':
      return toChecksumAddress(bytesToHex(evmHash(publicKey)));
  }
};

/** `RIPEMD160(SHA256(compressed pubkey))` — the cosmos-family and Bitcoin pubkey hash. */
const cosmosHash = (publicKey: Uint8Array): Uint8Array =>
  ripemd160(sha256(compress(publicKey)));

/** Last 20 bytes of `KECCAK256(uncompressed pubkey without the 0x04 prefix)`. */
const evmHash = (publicKey: Uint8Array): Uint8Array =>
  keccak_256(uncompress(publicKey).slice(1)).slice(-20);

const compress = (publicKey: Uint8Array): Uint8Array =>
  publicKey.length === 33 ? publicKey : secp256k1.Point.fromBytes(publicKey).toBytes(true);

const uncompress = (publicKey: Uint8Array): Uint8Array =>
  publicKey.length === 65 ? publicKey : secp256k1.Point.fromBytes(publicKey).toBytes(false);

/** EIP-55 mixed-case checksum encoding. */
export const toChecksumAddress = (hexAddress: string): string => {
  const lower = hexAddress.replace(/^0x/, '').toLowerCase();
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
};

/** Re-encodes a bech32 address under a different prefix, e.g. `cosmos1…` → `osmo1…`. */
export const convertBech32Prefix = (address: string, prefix: string): string => {
  const { words } = bech32.decode(address as `${string}1${string}`);
  return bech32.encode(prefix, words);
};

/** True when `address` is well-formed for the network (checksum included). */
export const isValidAddress = (address: string, network: string | Network): boolean => {
  const resolved = resolveNetwork(network);
  try {
    if (resolved.addressEncoding === 'evm') {
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
      const lower = address.toLowerCase();
      return address === lower || address === toChecksumAddress(lower);
    }
    const { prefix } = bech32.decode(address as `${string}1${string}`);
    return prefix === resolved.prefix;
  } catch {
    return false;
  }
};
