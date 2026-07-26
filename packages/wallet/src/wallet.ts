import { HDKey } from '@decryption/bip32';
import { bytesToHex } from '@decryption/hashes/utils';

import { publicKeyToAddress } from './address';
import { createMnemonic, mnemonicToSeed, WordCount } from './mnemonic';
import { derivationPath, Network, resolveNetwork } from './networks';

export interface AccountOptions {
  /** BIP44 account index (`m/44'/coin'/<account>'/…`). */
  account?: number;
  /** BIP44 change index — 0 for external addresses. */
  change?: number;
  /** BIP44 address index. */
  index?: number;
  /** Optional BIP39 passphrase (the "25th word"). */
  passphrase?: string;
  /** Derivation path override. When set, `account`/`change`/`index` are ignored. */
  path?: string;
}

export interface Account {
  network: string;
  path: string;
  address: string;
  /** Compressed secp256k1 public key, hex-encoded. */
  publicKey: string;
}

/** Derives one account. The private key never leaves this function. */
export const deriveAccount = (
  mnemonic: string,
  network: string | Network,
  options: AccountOptions = {}
): Account => {
  const resolved = resolveNetwork(network);
  const { hd, path } = deriveHdKey(mnemonic, resolved, options);
  try {
    const publicKey = hd.publicKey;
    if (!publicKey) throw new Error('derivation produced no public key');
    return {
      network: resolved.id,
      path,
      address: publicKeyToAddress(publicKey, resolved),
      publicKey: bytesToHex(publicKey),
    };
  } finally {
    hd.wipePrivateData();
  }
};

/**
 * Derives the private key for an account. Callers are responsible for zeroing the result;
 * everything else in this package avoids materializing private keys at all.
 */
export const derivePrivateKey = (
  mnemonic: string,
  network: string | Network,
  options: AccountOptions = {}
): Uint8Array => {
  const { hd } = deriveHdKey(mnemonic, resolveNetwork(network), options);
  const privateKey = hd.privateKey;
  if (!privateKey) throw new Error('derivation produced no private key');
  return Uint8Array.from(privateKey);
};

/** Derives the same account index across several networks — the usual "show me my addresses" view. */
export const deriveAccounts = (
  mnemonic: string,
  networks: (string | Network)[],
  options: AccountOptions = {}
): Account[] => networks.map((network) => deriveAccount(mnemonic, network, options));

export interface CreateWalletResult {
  mnemonic: string;
  accounts: Account[];
}

/** Generates a new mnemonic and derives its first account on each requested network. */
export const createWallet = (
  networks: (string | Network)[] = ['cosmoshub'],
  words: WordCount = 24,
  options: AccountOptions = {}
): CreateWalletResult => {
  const mnemonic = createMnemonic(words);
  return { mnemonic, accounts: deriveAccounts(mnemonic, networks, options) };
};

const deriveHdKey = (
  mnemonic: string,
  network: Network,
  options: AccountOptions
): { hd: HDKey; path: string } => {
  const path = options.path ?? derivationPath(network, options);
  const seed = mnemonicToSeed(mnemonic, options.passphrase ?? '');
  try {
    return { hd: HDKey.fromMasterSeed(seed).derive(path), path };
  } finally {
    seed.fill(0);
  }
};
