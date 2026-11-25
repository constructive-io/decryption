# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.5.0](https://github.com/constructive-io/decryption/compare/@decryption/cli@0.4.0...@decryption/cli@0.5.0) (2026-11-25)

### Bug Fixes

- **totp:** only request a code for items that carry a seed ([3d9136b](https://github.com/constructive-io/decryption/commit/3d9136b837d3a35429f00994b8470c932b9fe8a8))

### Features

- **accounts:** answer an MFA step-up with a code from the vault ([29de212](https://github.com/constructive-io/decryption/commit/29de212c20f21bf9c692431b52dc7b1291f3b922))
- **accounts:** hold and replay a request when the server asks for step-up ([83848d5](https://github.com/constructive-io/decryption/commit/83848d571a9e64cbb8e79755bfc5bdb2e44e7a9c))
- **accounts:** manage Constructive accounts and API keys from the vault ([5612497](https://github.com/constructive-io/decryption/commit/56124971fa18a3d00633cd0bc07e7b4f7050a619))
- **accounts:** serve harness credentials from the vault, and mint keys as a principal ([00d3f9a](https://github.com/constructive-io/decryption/commit/00d3f9a3fa3bfb658439c7e9e0704a9e1f9fad71))
- bulk JSON import for one-time codes; honour stored digits/period ([f340a37](https://github.com/constructive-io/decryption/commit/f340a3707b09f7a734a963668f4effdc5e79519f))
- **cli:** encrypt --binary and --recipient, with a streamed file format ([2179b77](https://github.com/constructive-io/decryption/commit/2179b777100a55db0cac4fd94a6ab46efc3cc13d))
- **cli:** encrypted workspaces — encrypt-section, decrypt-workspace, status, doctor, guard ([c9da630](https://github.com/constructive-io/decryption/commit/c9da630da49ee14d4f1e57a96887ae89f6e7ebe1))
- cosmology encrypt subcommand; remove the legacy command alias ([54833ce](https://github.com/constructive-io/decryption/commit/54833ce3108553edcbcea006be395f92baaab6a2))
- **desktop:** personal or organization principals, chosen not typed ([5e0278a](https://github.com/constructive-io/decryption/commit/5e0278abd0cdbb735dc7efb0d7f1c3deb680c512))
- **webauthn:** passkeys in the vault — dcrypt as a software authenticator ([0ff5c5b](https://github.com/constructive-io/decryption/commit/0ff5c5bca6c0ff45870d645316341b4ea103150d))

# [0.4.0](https://github.com/constructive-io/decryption/compare/@decryption/cli@0.3.0...@decryption/cli@0.4.0) (2026-07-27)

**Note:** Version bump only for package @decryption/cli

# [0.3.0](https://github.com/constructive-io/decryption/compare/@decryption/cli@0.2.0...@decryption/cli@0.3.0) (2026-07-27)

### Features

- cosmology CLI env vars, cosmology-compat rename, bitcoin-first networks ([2b6de58](https://github.com/constructive-io/decryption/commit/2b6de58dae636fc36f438f83abb772d2efc1daa2))
- dcrypt vault CLI — item, totp, export/import subcommands over @decryption/vault ([6a934ee](https://github.com/constructive-io/decryption/commit/6a934ee2fb67d841eec8ee99ea9f0e702f3d013e))

# 0.2.0 (2026-07-26)

### Features

- dcrypt CLI on inquirerer + appstash, flat eslint config ([7d213f2](https://github.com/constructive-io/decryption/commit/7d213f213f5df0a44d4d44b4ff78bdec2eba0a42))
