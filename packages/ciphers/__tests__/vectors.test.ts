import { gcm } from '../src/aes';
import { chacha20poly1305, xchacha20poly1305 } from '../src/chacha';
import { bytesToHex, hexToBytes, utf8ToBytes } from '../src/utils';

describe('@decryption/ciphers', () => {
  it('chacha20poly1305 matches RFC 8439 §2.8.2', () => {
    const key = hexToBytes('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f');
    const nonce = hexToBytes('070000004041424344454647');
    const aad = hexToBytes('50515253c0c1c2c3c4c5c6c7');
    const plaintext = utf8ToBytes(
      'Ladies and Gentlemen of the class of \'99: If I could offer you only one tip for the future, sunscreen would be it.'
    );
    const ct = chacha20poly1305(key, nonce, aad).encrypt(plaintext);
    expect(bytesToHex(ct).slice(0, 32)).toBe('d31a8d34648e60db7b86afbc53ef7ec2');
    expect(bytesToHex(chacha20poly1305(key, nonce, aad).decrypt(ct))).toBe(bytesToHex(plaintext));
  });

  it('xchacha20poly1305 round-trips and rejects tampering', () => {
    const key = new Uint8Array(32).fill(7);
    const nonce = new Uint8Array(24).fill(9);
    const aead = xchacha20poly1305(key, nonce);
    const ct = aead.encrypt(utf8ToBytes('attack at dawn'));
    expect(bytesToHex(xchacha20poly1305(key, nonce).decrypt(ct))).toBe(
      bytesToHex(utf8ToBytes('attack at dawn'))
    );
    ct[0] ^= 1;
    expect(() => xchacha20poly1305(key, nonce).decrypt(ct)).toThrow();
  });

  it('aes-256-gcm round-trips', () => {
    const key = new Uint8Array(32).fill(3);
    const nonce = new Uint8Array(12).fill(4);
    const ct = gcm(key, nonce).encrypt(utf8ToBytes('hello'));
    expect(bytesToHex(gcm(key, nonce).decrypt(ct))).toBe(bytesToHex(utf8ToBytes('hello')));
  });
});
