# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.4.1](https://github.com/constructive-io/decryption/compare/@decryption/vault@0.4.0...@decryption/vault@0.4.1) (2026-11-25)

**Note:** Version bump only for package @decryption/vault

# [0.4.0](https://github.com/constructive-io/decryption/compare/@decryption/vault@0.3.0...@decryption/vault@0.4.0) (2026-11-25)

### Bug Fixes

- **base32:** decode through bytea so TOTP keys with NUL bytes work ([5ca748d](https://github.com/constructive-io/decryption/commit/5ca748d8b8963d924b4608e7326b392e4111d987))
- **vault:** prove the rebuild really deployed, and report what it moved ([89786ba](https://github.com/constructive-io/decryption/commit/89786ba7f99f5fb770cf7fc9bd3df32645c9e50e))

### Features

- **accounts:** answer an MFA step-up with a code from the vault ([29de212](https://github.com/constructive-io/decryption/commit/29de212c20f21bf9c692431b52dc7b1291f3b922))
- **accounts:** manage Constructive accounts and API keys from the vault ([5612497](https://github.com/constructive-io/decryption/commit/56124971fa18a3d00633cd0bc07e7b4f7050a619))
- erase all local data, and rebuild the vault database in place ([9883b1e](https://github.com/constructive-io/decryption/commit/9883b1eb6ca6ba86d0897382f22df8c1fb95c1ff))
- **webauthn:** passkeys in the vault — dcrypt as a software authenticator ([0ff5c5b](https://github.com/constructive-io/decryption/commit/0ff5c5bca6c0ff45870d645316341b4ea103150d))

### Performance Improvements

- derive the snapshot key once so locking never blocks on argon2; feat: add-code dialog ([e85edf6](https://github.com/constructive-io/decryption/commit/e85edf6cb49010e22d10e7261f75eaad6029d474))

# [0.3.0](https://github.com/constructive-io/decryption/compare/@decryption/vault@0.2.0...@decryption/vault@0.3.0) (2026-07-27)

**Note:** Version bump only for package @decryption/vault

# 0.2.0 (2026-07-27)

### Features

- dcrypt desktop app — hardened Electron shell, blocks UI, TOTP, crypto tools ([3445b78](https://github.com/constructive-io/decryption/commit/3445b7876178f446cd40e3560c1708210bec1c53))
- dcrypt vault CLI — item, totp, export/import subcommands over @decryption/vault ([6a934ee](https://github.com/constructive-io/decryption/commit/6a934ee2fb67d841eec8ee99ea9f0e702f3d013e))
- pgpm workspace, dcrypt-vault module and @decryption/vault runtime ([769089f](https://github.com/constructive-io/decryption/commit/769089fc61811cc44b2e22aa220333e3b624beb0))
