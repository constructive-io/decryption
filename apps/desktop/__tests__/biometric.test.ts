import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dcrypt-unlock-'));
const prompts: string[] = [];
let touchId = true;

// the fingerprint path is macOS-only, and the tests run wherever CI runs
const realPlatform = process.platform;
Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

// the OS store, stood in for by a reversible transform: what matters here is
// that the file is not the password, and that a prompt gates reading it back
vi.mock('electron', () => ({
  app: { getName: () => 'dcrypt' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value).reverse(),
    decryptString: (data: Buffer) => Buffer.from(data).reverse().toString(),
  },
  systemPreferences: {
    canPromptTouchID: () => touchId,
    promptTouchID: async (reason: string) => {
      prompts.push(reason);
    },
  },
}));

vi.mock('../src/main/vault-service', () => ({ appDataPath: () => dir }));

const { biometricStatus, enrol, forget, unlockSecret } = await import('../src/main/biometric');

const secretFile = path.join(dir, 'config', 'unlock.bin');

beforeEach(async () => {
  prompts.length = 0;
  touchId = true;
  await forget();
});

afterAll(async () => {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  await fs.rm(dir, { recursive: true, force: true });
});

describe('remembered unlock', () => {
  it('has nothing to give until a password is enrolled', async () => {
    expect(biometricStatus().enrolled).toBe(false);
    expect(await unlockSecret('unlock')).toBeNull();
    expect(prompts).toEqual([]);
  });

  it('returns the password only after the OS prompt', async () => {
    await enrol('open sesame');
    expect(biometricStatus().enrolled).toBe(true);
    expect(await unlockSecret('unlock your dcrypt vault')).toBe('open sesame');
    expect(prompts).toEqual(['unlock your dcrypt vault']);
  });

  it('never writes the password to disk in the clear', async () => {
    await enrol('open sesame');
    const stored = await fs.readFile(secretFile);
    expect(stored.toString()).not.toContain('open sesame');
  });

  it('forgets it, leaving the password the only way in', async () => {
    await enrol('open sesame');
    await forget();
    expect(biometricStatus().enrolled).toBe(false);
    expect(await unlockSecret('unlock')).toBeNull();
  });

  it('still unlocks where there is a credential store but no fingerprint', async () => {
    touchId = false;
    await enrol('open sesame');
    expect(biometricStatus().biometric).toBe(false);
    expect(await unlockSecret('unlock')).toBe('open sesame');
    expect(prompts).toEqual([]);
  });
});
