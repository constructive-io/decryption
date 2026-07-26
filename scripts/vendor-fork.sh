#!/usr/bin/env bash
# Vendor an upstream ESM-only package into packages/<local>/src as a dual CJS+ESM fork.
#
#   ./scripts/vendor-fork.sh <upstream-name> <version> <local-dir>
#
# Copies the upstream TypeScript sources verbatim, strips `.ts` / `.js` extensions from
# relative import specifiers (this repo builds with moduleResolution: "node"), and
# rewrites cross-package `@noble/*` / `@scure/*` imports to their `@decryption/*` forks.
set -euo pipefail

UPSTREAM="$1"
VERSION="$2"
LOCAL="$3"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
npm pack "${UPSTREAM}@${VERSION}" >/dev/null
tar xzf ./*.tgz

SRC="package/src"
[ -d "$SRC" ] || SRC="package"

DEST="$ROOT/packages/$LOCAL/src"
rm -rf "$DEST"
mkdir -p "$DEST"

cd "$SRC"
find . -name '*.ts' ! -name '*.d.ts' -exec cp --parents {} "$DEST/" \;
cp "$WORK/package/LICENSE" "$ROOT/packages/$LOCAL/LICENSE"

cd "$DEST"
find . -name '*.ts' -print0 | xargs -0 sed -i \
  -e "s#\(from '\.[^']*\)\.ts'#\1'#g" \
  -e "s#\(from '\.[^']*\)\.js'#\1'#g" \
  -e "s#\(import('\.[^']*\)\.ts'#\1'#g" \
  -e "s#'@noble/hashes/#'@decryption/hashes/#g" \
  -e "s#'@noble/ciphers/#'@decryption/ciphers/#g" \
  -e "s#'@noble/curves/#'@decryption/curves/#g" \
  -e "s#'@scure/base'#'@decryption/base'#g" \
  -e "s#'@scure/bip32'#'@decryption/bip32'#g" \
  -e "s#'@scure/bip39'#'@decryption/bip39'#g" \
  -e "s#'@noble/hashes'#'@decryption/hashes'#g" \
  -e "s#'@noble/curves'#'@decryption/curves'#g"

echo "vendored ${UPSTREAM}@${VERSION} -> packages/${LOCAL}/src"
