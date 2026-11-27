# @decryption/cli

<p align="center" width="100%">
  <img height="250" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" />
</p>

<p align="center" width="100%">
  <a href="https://github.com/constructive-io/decryption/actions/workflows/ci.yml">
    <img height="20" src="https://github.com/constructive-io/decryption/actions/workflows/ci.yml/badge.svg" />
  </a>
  <a href="https://github.com/constructive-io/decryption/blob/main/LICENSE">
    <img height="20" alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg" />
  </a>
  <a href="https://www.npmjs.com/package/@decryption/cli"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/decryption?filename=packages%2Fcli%2Fpackage.json"/></a>
</p>


`dcrypt` — a local-first command line for encryption, BIP39 wallets and team secrets. Only
`dcrypt account` makes a network request, and only to the endpoint you name.

## Installation

```bash
npm install -g decryption      # short name; installs this package
dcrypt --help
```

`npm install -g @decryption/cli` installs the same command.

## Commands

| Command | What it does |
|---------|--------------|
| `dcrypt encrypt` / `decrypt` | Encrypt with a passphrase or to X25519 recipients; files of any size with `--binary` |
| `dcrypt encrypt-section` / `decrypt-workspace` | Keep folders of a git repository encrypted: one bundle per folder, one passphrase prompt |
| `dcrypt status` / `doctor` | Where each section stands; whether this machine and workspace are set up safely |
| `dcrypt guard` | Keep plaintext out of git: a pre-commit check, its hook, and files to paste |
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

# a private folder in a git repository, encrypted to everyone in recipients.txt
dcrypt encrypt-section finance           # finance/ → finance.tar.dcrypt
dcrypt decrypt-workspace                 # every bundle → its folder, one passphrase prompt

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
- **Decrypting gives back the bytes that were encrypted**, in every format: nothing is decoded,
  replaced or added on the way to a file or a pipe. Only on a terminal is a `dcrypt.v1` value that
  does not end its last line followed by a newline.
- Binary data is never written to a terminal: not ciphertext, and not decrypted output that holds a
  NUL byte or is not UTF-8. No such byte is written and the command fails, though text that came
  before it may already have been shown. Use `--out` or redirect.
- `--aad` belongs to the `dcrypt.v1` envelope only.

What "audited" does and does not cover for these formats is spelled out in the
[repository README](../../README.md#audit-status): the `@noble` / `@scure` primitives are, the
envelope is not.

## Encrypted workspaces

A workspace is a folder, usually a git repository, in which some folders are private. Each private
folder is a **section**: it is committed as one encrypted bundle, and its plaintext stays on your
machine.

```text
<workspace>/
  recipients.txt        who can decrypt: one dcrypt1… public key per line (committed)
  finance.tar.dcrypt    a section, encrypted (committed, ideally with Git LFS)
  finance/              the same section, decrypted (never committed)
  clients/
    northwind.tar.dcrypt
    northwind/
  .dcrypt/state.json    what this machine last encrypted or decrypted (never committed)
```

### Setting one up

```bash
dcrypt keys generate                             # once per machine
dcrypt guard snippet recipients > recipients.txt # then add each machine's "dcrypt keys show" line
dcrypt guard snippet gitignore > .gitignore      # allow-list: everything is private unless named
dcrypt guard snippet gitattributes > .gitattributes   # bundles go to Git LFS ("git lfs install")
dcrypt guard install                             # pre-commit hook
dcrypt doctor                                    # checks all of the above
```

Give every machine its own key, and add one **recovery** key that lives on no working machine, with
the word "recovery" in its label. `dcrypt doctor` and `dcrypt encrypt-section` warn until there is
one: without it, losing every machine key loses every section.

### Day to day

```bash
git pull
dcrypt decrypt-workspace          # one passphrase prompt; none when nothing changed
# … edit files under finance/ …
dcrypt status                     # finance  plaintext changed — run `dcrypt encrypt-section` …
dcrypt encrypt-section finance    # no passphrase: encrypting uses public keys only
git add finance.tar.dcrypt && git commit
```

- **Encrypting is opt-in, one section at a time.** Nothing is encrypted, and no bundle is rewritten,
  unless you name the section.
- **Nothing changes when nothing changed.** A section whose files are the same as its bundle is not
  re-encrypted, so git sees no difference. Running it again after `recipients.txt` changed does
  re-encrypt, to the new set of recipients.
- **One passphrase prompt.** `decrypt-workspace` unlocks your identity once and uses it for every
  section, and does not ask at all when every section is in sync. The passphrase comes from the
  prompt, `--passphrase-file`, `--passphrase-stdin` or `DCRYPT_PASSPHRASE`, never from argv.
- **A wrong passphrase never touches plaintext.** Each bundle is decrypted into a new folder beside
  the section and checked, file by file, against the manifest inside it. Only when all of it is
  there and correct does it replace the old folder. A wrong passphrase, a damaged or truncated
  bundle, a full disk or Ctrl-C leaves the section exactly as it was; the other sections are still
  decrypted, and the exit code says something failed.
- **Edits are not overwritten.** Plaintext with changes that are not encrypted yet is kept, and a
  bundle that is newer than your plaintext is not replaced, unless you pass `--force`. When both
  sides changed, both commands stop and say so.
- **Interrupt-safe.** Bundles and folders are written under a temporary name and renamed into
  place. A run that was killed is tidied up by the next one, which puts back a folder that was
  mid-swap.
- **File names are hidden.** A bundle is one encrypted file. The names, sizes and number of the
  files inside are not visible; the bundle's total size, and the fingerprints of its recipients,
  are.
- Decrypted files are created owner-only (`0600`, folders `0700`); the executable bit is kept.

`dcrypt status` shows one of these for each section:

| State | Meaning |
|-------|---------|
| `in sync` | the plaintext is what the bundle holds |
| `plaintext changed` | you edited files; `encrypt-section` when ready |
| `bundle changed` | the bundle is newer (a pull); `decrypt-workspace` updates the plaintext |
| `conflict` | both changed since they last agreed |
| `not decrypted` / `not encrypted` | only the bundle, or only the folder, exists |
| `unknown` | this machine has no record of the section; `decrypt-workspace` compares, and never overwrites a folder that differs |
| `not downloaded` | the bundle is still a Git LFS pointer; `git lfs pull` |
| `bundle unreadable` | the bundle is not a file `dcrypt` can read; restore it from git, or `encrypt-section --force` to make it again from the plaintext |
| `plaintext unreadable` | the folder holds a link, or a name a bundle cannot store |

A section that cannot be read is reported as such, and never stops the others from being reported or
decrypted.

### Keeping plaintext out of git

`dcrypt guard` reads what a commit would record and refuses three things: a file inside a section's
plaintext folder, a `*.dcrypt` file whose content is not encrypted, and a file `.gitignore` covers
that was added by force.

```bash
dcrypt guard                # what is staged; this is what the pre-commit hook runs
dcrypt guard --all          # everything tracked; for CI
dcrypt guard install        # write the hook (leaves a hook it did not write alone without --force)
dcrypt guard snippet        # gitignore, gitattributes, hook, ci, recipients
```

The `.gitignore` snippet is an allow-list: it ignores everything and then names what may be
committed, so a new file is private until a line says otherwise. The hook fails closed: if `dcrypt`
is not on the `PATH`, the commit is refused, not waved through.

`dcrypt doctor` checks Node.js, your identity, `recipients.txt` (including the recovery recipient),
every section, the hook, the ignore rules, Git LFS and whether anything tracked is plaintext. It
reads only, asks for no passphrase, and exits non-zero only when a check fails; warnings do not.

### What a bundle is, and is not

A bundle is a tar archive encrypted to the recipients in the [file format](#encrypting-files) above.
The archive is deterministic (sorted names, no owners, no timestamps), and its first entry is a
manifest listing every file's path, size and SHA-256. The manifest is what makes "unchanged" cheap
to establish and what an extraction is verified against.

- **It is an ordinary tar inside.** Without the workspace commands,
  `dcrypt decrypt --in finance.tar.dcrypt --out finance.tar && tar -xf finance.tar` gets the files
  back, along with the manifest as `.dcrypt-manifest.json`.
- **A bundle does not say who made it.** Recipient keys are public, so anyone who can write to the
  repository can produce a bundle that decrypts. `decrypt-workspace` refuses a bundle that tries to
  write outside its folder or whose content does not match its manifest, but it cannot tell you who
  wrote that content. That comes from git: review, branch protection, signed commits.
- **Removing a recipient is not retroactive.** A key taken out of `recipients.txt` stops being used
  the next time each section is encrypted (`status` shows which still need it). Bundles already in
  git history stay readable with the old key, so rotate anything in them that matters.
- **Regular files only.** Links and special files are refused, empty folders are not kept,
  `.DS_Store` is skipped, and ownership and timestamps are not recorded. A single file must be smaller
  than 8 GiB. File names are stored NFC-normalized; a name containing a backslash is refused.
- None of this is audited: see [audit status](../../README.md#audit-status).

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
| 3 | Corrupt or unsupported input, including a bundle that does not match its manifest |
| 4 | Not found — including no identity on this machine, and a bundle that is still a Git LFS pointer |
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
