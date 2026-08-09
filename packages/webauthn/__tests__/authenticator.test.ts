import { base64urlnopad } from '@decryption/base';
import { p256 } from '@decryption/curves/nist';
import { sha256 } from '@decryption/hashes/sha2';

import {
  assertPasskey,
  coseKey,
  createPasskey,
  ES256,
  verifyAssertion,
} from '../src/authenticator';
import { decode, encode } from '../src/cbor';

const RP = { rpId: 'auth.example.com', origin: 'https://auth.example.com' };
const challenge = base64urlnopad.encode(Uint8Array.from({ length: 32 }, (_, i) => i));

const register = () =>
  createPasskey({ ...RP, challenge, userName: 'ci@example.com' });

/** What a relying party pulls out of the attestation object. */
const attested = (attestationObject: string) => {
  const object = decode(base64urlnopad.decode(attestationObject)) as Map<string, unknown>;
  const authData = object.get('authData') as Uint8Array;
  const idLength = (authData[53] << 8) | authData[54];
  return {
    fmt: object.get('fmt'),
    rpIdHash: authData.slice(0, 32),
    flags: authData[32],
    signCount: new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0),
    credentialId: authData.slice(55, 55 + idLength),
    coseKey: authData.slice(55 + idLength),
  };
};

describe('createPasskey', () => {
  it('binds the credential to the site, and to nothing else', () => {
    const { passkey, response } = register();
    const data = attested(response.response.attestationObject);

    expect(Buffer.from(data.rpIdHash)).toEqual(
      Buffer.from(sha256(new TextEncoder().encode(RP.rpId)))
    );
    expect(base64urlnopad.encode(data.credentialId)).toBe(passkey.credentialId);
    expect(data.signCount).toBe(0);
  });

  it('attests to nothing, because a software authenticator has nothing to attest', () => {
    const { response } = register();
    expect(attested(response.response.attestationObject).fmt).toBe('none');
  });

  it('reports the key as present, verified and backed up', () => {
    const { flags } = attested(register().response.response.attestationObject);
    expect(flags & 0x01).toBeTruthy(); // user present
    expect(flags & 0x04).toBeTruthy(); // user verified — the vault was unlocked
    expect(flags & 0x08).toBeTruthy(); // backup eligible: the vault is a file
    expect(flags & 0x40).toBeTruthy(); // attested credential data follows
  });

  it('publishes the public half as a canonical ES256 COSE key', () => {
    const { passkey, response } = register();
    const key = decode(
      attested(response.response.attestationObject).coseKey
    ) as Map<number, number | Uint8Array>;

    expect(key.get(1)).toBe(2); // EC2
    expect(key.get(3)).toBe(ES256);
    expect(key.get(-1)).toBe(1); // P-256

    const publicKey = p256.getPublicKey(base64urlnopad.decode(passkey.privateKey), false);
    expect(Buffer.from(key.get(-2) as Uint8Array)).toEqual(Buffer.from(publicKey.slice(1, 33)));
    // and re-encoding gives back the same bytes, so a relying party comparing
    // the stored key to a re-derived one agrees
    expect(Buffer.from(encode(key))).toEqual(Buffer.from(coseKey(publicKey)));
  });

  it('never repeats a credential id or a key', () => {
    const first = register().passkey;
    const second = register().passkey;
    expect(first.credentialId).not.toBe(second.credentialId);
    expect(first.privateKey).not.toBe(second.privateKey);
  });
});

describe('assertPasskey', () => {
  const signIn = () => {
    const { passkey } = register();
    const publicKey = p256.getPublicKey(base64urlnopad.decode(passkey.privateKey), false);
    const assertion = assertPasskey(passkey, { ...RP, challenge });
    return { passkey, publicKey, assertion };
  };

  it('produces a signature the site can verify', () => {
    const { publicKey, assertion } = signIn();
    expect(
      verifyAssertion(
        publicKey,
        base64urlnopad.decode(assertion.response.response.authenticatorData),
        base64urlnopad.decode(assertion.response.response.clientDataJSON),
        base64urlnopad.decode(assertion.response.response.signature)
      )
    ).toBe(true);
  });

  it('signs the origin, so a signature cannot be replayed at another site', () => {
    const { publicKey, assertion } = signIn();
    const clientDataJSON = JSON.parse(
      new TextDecoder().decode(base64urlnopad.decode(assertion.response.response.clientDataJSON))
    ) as { type: string; challenge: string; origin: string };

    expect(clientDataJSON).toMatchObject({
      type: 'webauthn.get',
      challenge,
      origin: RP.origin,
    });

    const phished = new TextEncoder().encode(
      JSON.stringify({ ...clientDataJSON, origin: 'https://evil.example.com' })
    );
    expect(
      verifyAssertion(
        publicKey,
        base64urlnopad.decode(assertion.response.response.authenticatorData),
        phished,
        base64urlnopad.decode(assertion.response.response.signature)
      )
    ).toBe(false);
  });

  it('advances the sign count, so a cloned key gives itself away', () => {
    const { passkey } = register();
    const first = assertPasskey(passkey, { ...RP, challenge });
    const second = assertPasskey(first.passkey, { ...RP, challenge });

    expect(first.passkey.signCount).toBe(1);
    expect(second.passkey.signCount).toBe(2);
    // and the count is in the signed bytes, not just in the returned object
    const authData = base64urlnopad.decode(second.response.response.authenticatorData);
    expect(new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0)).toBe(2);
  });

  it('carries the user handle, so the site can sign in without a username', () => {
    const { passkey, assertion } = signIn();
    expect(assertion.response.response.userHandle).toBe(passkey.userHandle);
  });

  it('does not carry attested credential data', () => {
    const { assertion } = signIn();
    const authData = base64urlnopad.decode(assertion.response.response.authenticatorData);
    expect(authData.length).toBe(37);
    expect(authData[32] & 0x40).toBe(0);
  });
});
