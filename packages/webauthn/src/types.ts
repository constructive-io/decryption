/** A passkey as dcrypt holds it: a P-256 key and what the site needs to find it. */
export interface Passkey {
  /** base64url, as a relying party sends and receives it. */
  credentialId: string;
  /** The site the key belongs to — a passkey signs for nothing else. */
  rpId: string;
  /** base64url-encoded 32-byte P-256 scalar. Only this is a secret. */
  privateKey: string;
  /** The user handle the site knows, base64url. Enables usernameless sign-in. */
  userHandle: string;
  userName: string;
  /** How many assertions this key has made; a site rejects a count going backwards. */
  signCount: number;
}

/** What a site asks for when a passkey is created. */
export interface RegistrationRequest {
  rpId: string;
  origin: string;
  /** base64url, from `webauthn_begin_registration`. */
  challenge: string;
  userName: string;
  /** base64url; generated when absent. */
  userHandle?: string;
}

/** What a site asks for when a passkey is used. */
export interface AssertionRequest {
  origin: string;
  /** base64url, from `webauthn_begin_sign_in`. */
  challenge: string;
}

/**
 * The shape `navigator.credentials.create()` resolves to, as a relying party
 * such as `@simplewebauthn/server` expects to receive it over the wire.
 */
export interface RegistrationResponse {
  id: string;
  rawId: string;
  type: 'public-key';
  clientExtensionResults: Record<string, never>;
  authenticatorAttachment: 'platform';
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports: string[];
    publicKey: string;
    publicKeyAlgorithm: number;
    authenticatorData: string;
  };
}

/** The shape `navigator.credentials.get()` resolves to. */
export interface AssertionResponse {
  id: string;
  rawId: string;
  type: 'public-key';
  clientExtensionResults: Record<string, never>;
  authenticatorAttachment: 'platform';
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string;
  };
}

/** A new passkey, plus the one-off response that registers it with the site. */
export interface Registration {
  passkey: Passkey;
  response: RegistrationResponse;
}

/** An assertion, and the passkey with its sign count moved on. */
export interface Assertion {
  passkey: Passkey;
  response: AssertionResponse;
}
