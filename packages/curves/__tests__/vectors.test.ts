import { ed25519, x25519 } from '../src/ed25519';
import { secp256k1 } from '../src/secp256k1';
import { bytesToHex, hexToBytes } from '../src/utils';

describe('@decryption/curves', () => {
  it('x25519 matches the RFC 7748 §6.1 key exchange', () => {
    const alicePriv = hexToBytes('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
    const bobPriv = hexToBytes('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
    const alicePub = x25519.getPublicKey(alicePriv);
    const bobPub = x25519.getPublicKey(bobPriv);
    expect(bytesToHex(alicePub)).toBe(
      '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a'
    );
    expect(bytesToHex(x25519.getSharedSecret(alicePriv, bobPub))).toBe(
      bytesToHex(x25519.getSharedSecret(bobPriv, alicePub))
    );
  });

  it('ed25519 signs and verifies', () => {
    const priv = ed25519.utils.randomSecretKey();
    const pub = ed25519.getPublicKey(priv);
    const msg = new Uint8Array([1, 2, 3]);
    expect(ed25519.verify(ed25519.sign(msg, priv), msg, pub)).toBe(true);
  });

  it('secp256k1 derives the well-known public key for privkey 1', () => {
    const pub = secp256k1.getPublicKey(hexToBytes('00'.repeat(31) + '01'), true);
    expect(bytesToHex(pub)).toBe(
      '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
    );
  });
});
