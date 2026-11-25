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


`dcrypt` — a local-first command line for encryption, BIP39 wallets and team secrets. Only
`dcrypt account` makes a network request, and only to the endpoint you name.

## Installation

```bash
npm install -g @decryption/cli
dcrypt --help
```

## Commands

| Command | What it does |
|---------|--------------|
| `dcrypt encrypt` / `decrypt` | Encrypt with a passphrase or to X25519 recipients; files of any size with `--binary` |
| `dcrypt wallet create\|address\|validate` | BIP39 mnemonics and offline address derivation |
| `dcrypt keys generate\|show\|verify` | Your X25519 identity, stored encrypted |
| `dcrypt secrets …` | Team secrets files, `.env` generation, recipient management |
| `dcrypt keychain set\|get\|del\|list` | Named local secrets, always encrypted |
| `dcrypt shamir split\|combine` | Authenticated Shamir shares |
| `dcrypt salt generate\|encrypt\|decrypt` | Two-layer encryption (data under a salt, salt under your passphrase) |
| `dcrypt cosmology decrypt\|encrypt\|upgrade` | Read, write and migrate data in the cosmology CLI format |

Every command supports `--help`.

## Examples

```bash
# a wallet, encrypted at rest
dcrypt wallet create --words 24 --network osmosis --encrypt --out wallet.dcrypt

# a large file, to yourself and a teammate — no shared passphrase
dcrypt keys show                         # prints your dcrypt1… recipient
dcrypt encrypt --binary --recipient dcrypt1… --recipient dcrypt1… \
  --in backup.tar --out backup.tar.dcrypt
dcrypt decrypt --in backup.tar.dcrypt --out backup.tar

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

## Encrypting files

`dcrypt encrypt` writes one of two formats, and `dcrypt decrypt` detects which it was given:

| Flags | Output | Use for |
|-------|--------|---------|
| *(none)* | `dcrypt.v1.…` text, passphrase | short secrets you paste around; held in memory |
| `--binary` | binary file, passphrase | files of any size |
| `--binary --recipient <key>` | binary file, X25519 recipients | files several people or machines must open |
| `--recipient <key>` | `dcrypt.v2.…` text, X25519 recipients | small values for recipients; held in memory |

- `--recipient` takes a `dcrypt1…` public key and can be repeated. `--recipients-file <path>` reads one
  key per line; anything after the key is a label, and `#` starts a comment. Encrypting to recipients
  asks for no passphrase. Decrypting uses your stored identity (`dcrypt keys generate`) and asks for
  the passphrase that protects it.
- **Large files are streamed.** The binary format is encrypted in 64 KiB chunks
  ([how](../core#file-format-version-2)), from a file or a pipe to a file or a pipe, holding one chunk
  at a time. Resident memory still shows garbage the Node.js collector has not reclaimed yet: in our
  runs it levelled off between roughly 0.3 and 1 GB for inputs from 300 MB to 4 GiB instead of growing
  with the input, and a 1.2 GB decrypt completed at 336 MB under `--max-old-space-size=64`.
- **`--out` is written atomically.** Output goes to an owner-only temporary file next to the
  destination and is renamed into place only after every byte has been written and, when decrypting,
  authenticated. A wrong passphrase, a truncated or modified file, a full disk or Ctrl-C leaves the
  destination exactly as it was.
- **On stdout there is nothing to rename.** Decrypted chunks are written as they authenticate, so a
  file that turns out to be truncated has already produced output: check the exit code before using it.
- Binary ciphertext is never written to a terminal; use `--out` or redirect.
- `--aad` belongs to the `dcrypt.v1` envelope only.

What "audited" does and does not cover for these formats is spelled out in the
[repository README](../../README.md#audit-status): the `@noble` / `@scure` primitives are, the
envelope is not.

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

Every prompt has a flag, so the CLI works in CI. `dcrypt` only prompts on a terminal: when stdin is a
pipe or a file it is treated as data, never as answers, and a missing passphrase is an error instead
of a prompt.

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
| 4 | Not found — including no identity on this machine |
| 5 | Your identity is not a recipient of this file |

## Storage layout

```text
~/.dcrypt/
  config/identity.json    X25519 identity, encrypted under your passphrase
  data/keychain.json      named secrets, each encrypted
  data/vaults/<name>.json team secrets files
```

Managed with [appstash](https://www.npmjs.com/package/appstash), and shared byte-for-byte with the
desktop app, so both tools see the same vaults.
