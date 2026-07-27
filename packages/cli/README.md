# @decryption/cli

<p align="center" width="100%">
  <img height="250" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" />
</p>

<p align="center" width="100%">
  <a href="https://github.com/constructive-io/decryption/actions/workflows/ci.yml">
    <img height="20" src="https://github.com/constructive-io/decryption/actions/workflows/ci.yml/badge.svg" />
  </a>
  <a href="https://www.npmjs.com/package/@decryption/cli"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/decryption?filename=packages%2Fcli%2Fpackage.json"/></a>
</p>


`dcrypt` — a local-first command line for encryption, BIP39 wallets and team secrets. No command
in this CLI makes a network request.

## Installation

```bash
npm install -g @decryption/cli
dcrypt --help
```

## Commands

| Command | What it does |
|---------|--------------|
| `dcrypt encrypt` / `decrypt` | Passphrase encryption (Argon2id + XChaCha20-Poly1305) |
| `dcrypt wallet create\|address\|validate` | BIP39 mnemonics and offline address derivation |
| `dcrypt keys generate\|show\|verify` | Your X25519 identity, stored encrypted |
| `dcrypt secrets …` | Team secrets files, `.env` generation, recipient management |
| `dcrypt keychain set\|get\|del\|list` | Named local secrets, always encrypted |
| `dcrypt shamir split\|combine` | Authenticated Shamir shares |
| `dcrypt salt generate\|encrypt\|decrypt` | Two-layer encryption (data under a salt, salt under your passphrase) |
| `dcrypt cosmology decrypt\|upgrade` | Read and migrate data from the cosmology CLI (`legacy` still works as an alias) |

Every command supports `--help`.

## Examples

```bash
# a wallet, encrypted at rest
dcrypt wallet create --words 24 --network osmosis --encrypt --out wallet.dcrypt

# team secrets
dcrypt keys generate
dcrypt secrets init --vault production
dcrypt secrets set DATABASE_URL --in url.txt --vault production
dcrypt secrets add-recipient --label ada --recipient dcrypt1…
dcrypt secrets export --vault production --format dotenv --out .env
dcrypt secrets run --vault production -- npm start

# break-glass shares of a mnemonic
dcrypt shamir split --in mnemonic.txt --shares 5 --threshold 3
```

## Handling secrets

- **Passphrases are never read from argv.** `--passphrase` is rejected outright, because argv is
  visible to every process on the machine. Use `--passphrase-file <path>`, `--passphrase-stdin`,
  or the masked interactive prompt.
- Values can always be read with `--in <file>` or piped on stdin, and written with `--out <file>`
  (created with mode `0600`) — so a secret never has to appear on your screen or in shell history.
- `dcrypt secrets run -- <cmd>` injects secrets into a child process's environment without ever
  writing a plaintext `.env` to disk.
- `dcrypt keychain` has no plaintext mode. The old cosmology CLI stored the *plaintext* when you
  passed `--encrypted`; that bug is not reproduced here.

## Non-interactive use

Every prompt has a flag, so the CLI works in CI:

```bash
dcrypt decrypt --in secret.dcrypt --passphrase-file /run/secrets/passphrase --out plain.txt
```

### Environment variables

Every variable the cosmology CLI read still works, plus `DCRYPT_`-prefixed aliases
(`DCRYPT_MNEMONIC`, `DCRYPT_SALT`, ...) for environments where the bare names would collide:

| Variable | Used by |
|----------|---------|
| `MNEMONIC` | `wallet address` / `wallet validate` |
| `SALT` | `cosmology decrypt` / `cosmology upgrade` |
| `ENCRYPTED_SALT` | the two-layer cosmology scheme |
| `KEYCHAIN_ACCOUNT` | keychain namespace (default `dcrypt`) |
| `DCRYPT_PASSPHRASE` | any command that asks for a passphrase |

Resolution order everywhere: explicit flag, then environment, then stdin, then the
interactive prompt.

```bash
SALT=my-salt dcrypt cosmology decrypt --in old.txt
MNEMONIC="..." dcrypt wallet address --network ethereum
```

Add `--json` for machine-readable output, and check exit codes:

| Code | Meaning |
|------|---------|
| 1 | Usage error |
| 2 | Wrong passphrase, or the ciphertext was tampered with |
| 3 | Corrupt or unsupported input |
| 4 | Not found |
| 5 | Not a recipient |

## Storage layout

```text
~/.dcrypt/
  config/identity.json    X25519 identity, encrypted under your passphrase
  data/keychain.json      named secrets, each encrypted
  data/vaults/<name>.json team secrets files
```

Managed with [appstash](https://www.npmjs.com/package/appstash), and shared byte-for-byte with the
desktop app, so both tools see the same vaults.
