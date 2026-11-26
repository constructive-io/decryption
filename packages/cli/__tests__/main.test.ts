import { readFileSync } from 'fs';
import { join } from 'path';

import { main } from '../src';

// The `decryption` package's `dcrypt` command is `require('@decryption/cli').main()`.
// If this export goes away, `npm install -g decryption` installs a command that does nothing.
describe('main', () => {
  it('is exported for the decryption package', () => {
    expect(typeof main).toBe('function');
  });

  it('is what the decryption package runs', () => {
    const wrapper = readFileSync(join(__dirname, '../../decryption/index.js'), 'utf8');
    expect(wrapper).toContain("require('@decryption/cli')");
    expect(wrapper).toContain('cli.main()');
  });
});
