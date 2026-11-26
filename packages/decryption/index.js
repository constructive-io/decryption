#!/usr/bin/env node
// `decryption` is the entry point: `npm install -g decryption` installs the `dcrypt` command, and
// `require('decryption')` gives you the @decryption/cli API. This package holds no code of its own;
// it runs the CLI at the exact version it depends on.
const cli = require('@decryption/cli');

if (require.main === module) {
  cli.main();
} else {
  module.exports = cli;
}
