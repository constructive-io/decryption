# @decryption/wallet

BIP39 mnemonics, BIP32 derivation and address encoding — entirely offline. This package has no
chain registry, no RPC client and no transaction signing: it turns a mnemonic into addresses and
stops there.

## Installation

```bash
npm install @decryption/wallet
```

## Usage

```typescript
import { createWallet, deriveAccounts, assertValidMnemonic } from '@decryption/wallet';

const { mnemonic, accounts } = createWallet(['cosmoshub', 'osmosis', 'ethereum'], 24);
// accounts[0] => { network: 'cosmoshub', path: "m/44'/118'/0'/0/0", address: 'cosmos1…', publicKey: '02…' }

assertValidMnemonic(userInput); // throws MnemonicError naming the actual problem
const restored = deriveAccounts(userInput, ['juno'], { account: 1, index: 3 });
```

Chains that are not built in — most cosmos-family chains differ only by prefix and coin type:

```typescript
import { defineNetwork, deriveAccount } from '@decryption/wallet';

const dydx = defineNetwork({
  id: 'dydx',
  name: 'dYdX',
  coinType: 118,
  addressEncoding: 'bech32',
  prefix: 'dydx',
});

deriveAccount(mnemonic, dydx);
```

## Built-in networks

| Network | Coin type | Address |
|---------|-----------|---------|
| `cosmoshub`, `osmosis`, `juno`, `stargaze`, `akash`, `celestia` | 118 | bech32 |
| `secret` | 529 | bech32 |
| `terra` | 330 | bech32 |
| `ethereum` | 60 | EIP-55 checksummed hex |
| `bitcoin` | 0 | bech32 P2WPKH |

## Mnemonics

```typescript
import { createMnemonic, mnemonicToBytes, bytesToMnemonic } from '@decryption/wallet';

createMnemonic(12);           // 12/15/18/21/24 words
mnemonicToBytes(mnemonic);    // raw entropy, checksum verified
bytesToMnemonic(entropy);
```

`assertValidMnemonic` distinguishes the three failure modes users actually hit — wrong word count,
a word outside the wordlist, and a failed checksum — so a UI can say which word is wrong instead
of "invalid mnemonic".

## Private keys

`deriveAccount` never returns private material and wipes the HD node before returning. When a
private key is genuinely needed, ask for it explicitly and zero it when you are done:

```typescript
import { derivePrivateKey } from '@decryption/wallet';

const key = derivePrivateKey(mnemonic, 'cosmoshub');
try {
  /* … */
} finally {
  key.fill(0);
}
```
