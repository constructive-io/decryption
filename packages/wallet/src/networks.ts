/**
 * Offline network definitions: enough to derive and encode an address, and nothing else.
 * There are no RPC endpoints here by design — this package never touches the network.
 */
export interface Network {
  /** Lookup key, e.g. `cosmoshub`. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** SLIP-44 coin type used in the derivation path. */
  coinType: number;
  /** How a public key becomes an address. */
  addressEncoding: 'bech32' | 'evm' | 'p2wpkh';
  /** Bech32 human-readable part, for `bech32` and `p2wpkh` encodings. */
  prefix?: string;
}

const cosmos = (id: string, name: string, prefix: string, coinType = 118): Network => ({
  id,
  name,
  coinType,
  addressEncoding: 'bech32',
  prefix,
});

/** Built-in networks. Anything missing can be supplied with {@link defineNetwork}. */
export const NETWORKS: Record<string, Network> = {
  cosmoshub: cosmos('cosmoshub', 'Cosmos Hub', 'cosmos'),
  osmosis: cosmos('osmosis', 'Osmosis', 'osmo'),
  juno: cosmos('juno', 'Juno', 'juno'),
  stargaze: cosmos('stargaze', 'Stargaze', 'stars'),
  akash: cosmos('akash', 'Akash', 'akash'),
  celestia: cosmos('celestia', 'Celestia', 'celestia'),
  secret: cosmos('secret', 'Secret Network', 'secret', 529),
  terra: cosmos('terra', 'Terra', 'terra', 330),
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    coinType: 60,
    addressEncoding: 'evm',
  },
  bitcoin: {
    id: 'bitcoin',
    name: 'Bitcoin',
    coinType: 0,
    addressEncoding: 'p2wpkh',
    prefix: 'bc',
  },
};

/**
 * Builds a network definition for a chain that is not built in — the common case for
 * cosmos-family chains, which differ only by bech32 prefix and coin type.
 */
export const defineNetwork = (network: Network): Network => {
  if (network.addressEncoding !== 'evm' && !network.prefix) {
    throw new Error(`network ${network.id} requires a bech32 prefix`);
  }
  return network;
};

export const resolveNetwork = (network: string | Network): Network => {
  if (typeof network !== 'string') return defineNetwork(network);
  const found = NETWORKS[network];
  if (!found) {
    throw new Error(
      `unknown network "${network}"; known: ${Object.keys(NETWORKS).join(', ')} (use defineNetwork for others)`
    );
  }
  return found;
};

/** BIP44 path for a network: `m/44'/coinType'/account'/change/index`. */
export const derivationPath = (
  network: Network,
  { account = 0, change = 0, index = 0 } = {}
): string => `m/44'/${network.coinType}'/${account}'/${change}/${index}`;
