import { base64urlnopad } from '@decryption/base';
import { p256 } from '@decryption/curves/nist';
import { sha256 } from '@decryption/hashes/sha2';

import { CborValue, encode } from './cbor';
import type {
  Assertion,
  AssertionRequest,
  Passkey,
  Registration,
  RegistrationRequest,
} from './types';

/** ES256: ECDSA with P-256 and SHA-256, the algorithm every site accepts. */
export const ES256 = -7;

/**
 * Authenticators identify their make and model with an AAGUID. A software
 * authenticator is required to report all-zero, which also says honestly that
 * this key is not shielded by tamper-resistant hardware.
 */
const AAGUID = new Uint8Array(16);

const FLAG = {
  userPresent: 0x01,
  userVerified: 0x04,
  /** The key is one that can be backed up — the vault is a file you can copy. */
  backupEligible: 0x08,
  backedUp: 0x10,
  attestedCredentialData: 0x40,
} as const;

const concat = (...chunks: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};

const uint32 = (value: number): Uint8Array =>
  Uint8Array.from([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);

/** The uncompressed point, as a COSE_Key — the form a relying party stores. */
export const coseKey = (publicKey: Uint8Array): Uint8Array =>
  encode(
    new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, ES256], // alg
      [-1, 1], // crv: P-256
      [-2, publicKey.slice(1, 33)], // x
      [-3, publicKey.slice(33, 65)], // y
    ])
  );

/**
 * `authenticatorData`: which site, what the user did, how many times this key
 * has signed — and on registration, the credential itself.
 */
const authenticatorData = (
  rpId: string,
  signCount: number,
  attested?: { credentialId: Uint8Array; publicKey: Uint8Array }
): Uint8Array => {
  const flags =
    FLAG.userPresent |
    FLAG.userVerified |
    FLAG.backupEligible |
    FLAG.backedUp |
    (attested ? FLAG.attestedCredentialData : 0);
  const head = concat(sha256(new TextEncoder().encode(rpId)), Uint8Array.from([flags]), uint32(signCount));
  if (!attested) return head;
  const { credentialId, publicKey } = attested;
  return concat(
    head,
    AAGUID,
    Uint8Array.from([(credentialId.length >> 8) & 0xff, credentialId.length & 0xff]),
    credentialId,
    coseKey(publicKey)
  );
};

/**
 * What the browser would have shown the authenticator: the challenge it is
 * signing, and the origin it is signing it for. The origin is in here rather
 * than in the signature's own fields, which is what makes a passkey
 * unphishable — a site cannot get a signature naming a different origin.
 */
const clientData = (type: string, challenge: string, origin: string): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({ type, challenge, origin, crossOrigin: false })
  );

/** ECDSA over `authenticatorData || sha256(clientDataJSON)`, DER as WebAuthn wants. */
const sign = (privateKey: Uint8Array, authData: Uint8Array, clientDataJSON: Uint8Array): Uint8Array =>
  p256.Signature.fromBytes(
    p256.sign(concat(authData, sha256(clientDataJSON)), privateKey)
  ).toBytes('der');

/**
 * Mint a passkey for a site. The private key never leaves the return value —
 * the caller's job is to put it straight into the vault.
 */
export const createPasskey = (request: RegistrationRequest): Registration => {
  const privateKey = p256.utils.randomSecretKey();
  const publicKey = p256.getPublicKey(privateKey, false);
  const credentialId = crypto.getRandomValues(new Uint8Array(32));
  const userHandle =
    request.userHandle ?? base64urlnopad.encode(crypto.getRandomValues(new Uint8Array(32)));

  const authData = authenticatorData(request.rpId, 0, { credentialId, publicKey });
  const clientDataJSON = clientData('webauthn.create', request.challenge, request.origin);

  // fmt 'none': a software authenticator attests to nothing about its hardware,
  // and claiming otherwise is exactly the lie attestation exists to catch
  const attestationObject = encode(
    new Map<CborValue, CborValue>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData],
    ])
  );

  const id = base64urlnopad.encode(credentialId);
  return {
    passkey: {
      credentialId: id,
      rpId: request.rpId,
      privateKey: base64urlnopad.encode(privateKey),
      userHandle,
      userName: request.userName,
      signCount: 0,
    },
    response: {
      id,
      rawId: id,
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: base64urlnopad.encode(clientDataJSON),
        attestationObject: base64urlnopad.encode(attestationObject),
        transports: ['internal', 'hybrid'],
        publicKey: base64urlnopad.encode(coseKey(publicKey)),
        publicKeyAlgorithm: ES256,
        authenticatorData: base64urlnopad.encode(authData),
      },
    },
  };
};

/**
 * Sign a site's challenge with a passkey. The returned passkey carries the
 * incremented sign count, which the caller must persist: a site that sees the
 * count fail to advance is entitled to conclude the key has been cloned.
 */
export const assertPasskey = (passkey: Passkey, request: AssertionRequest): Assertion => {
  const signCount = passkey.signCount + 1;
  const authData = authenticatorData(passkey.rpId, signCount);
  const clientDataJSON = clientData('webauthn.get', request.challenge, request.origin);
  const signature = sign(base64urlnopad.decode(passkey.privateKey), authData, clientDataJSON);

  return {
    passkey: { ...passkey, signCount },
    response: {
      id: passkey.credentialId,
      rawId: passkey.credentialId,
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: base64urlnopad.encode(clientDataJSON),
        authenticatorData: base64urlnopad.encode(authData),
        signature: base64urlnopad.encode(signature),
        userHandle: passkey.userHandle,
      },
    },
  };
};

/**
 * Check an assertion's signature. This is only the cryptographic half of what a
 * relying party does — it still owes the challenge, origin, RP id hash and sign
 * count checks — but a round trip whose signature is never verified proves
 * nothing, which is what the tests are for.
 */
export const verifyAssertion = (
  publicKey: Uint8Array,
  authData: Uint8Array,
  clientDataJSON: Uint8Array,
  signature: Uint8Array
): boolean =>
  p256.verify(signature, concat(authData, sha256(clientDataJSON)), publicKey, { format: 'der' });
