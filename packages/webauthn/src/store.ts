import { Vault, VaultItem } from '@decryption/vault';

import { assertPasskey, createPasskey } from './authenticator';
import type {
  AssertionRequest,
  AssertionResponse,
  Passkey,
  RegistrationRequest,
  RegistrationResponse,
} from './types';

const FIELDS = {
  rpId: 'rp_id',
  credentialId: 'credential_id',
  userHandle: 'user_handle',
  userName: 'user_name',
  signCount: 'sign_count',
  privateKey: 'private_key',
} as const;

/** A stored passkey, as the UI and CLI list it — no private key in sight. */
export interface PasskeyRecord {
  itemId: string;
  rpId: string;
  credentialId: string;
  userName: string;
  signCount: number;
  createdAt: string;
}

export class PasskeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasskeyError';
  }
}

/**
 * Passkeys kept as vault items: dcrypt is the authenticator, and the vault is
 * its secure element. The private key is the only concealed field — a site
 * name and a sign count are not secrets, and leaving them readable is what
 * lets the list render without decrypting anything.
 *
 * A passkey is therefore covered by the master passphrase, by lock, and by
 * backup/restore, and unlike a hardware key it can be restored onto a new
 * machine from a backup.
 */
export class PasskeyStore {
  constructor(private readonly vault: Vault) {}

  /**
   * Mint a passkey for a site and return the registration the relying party
   * verifies. The key is written to the vault before the response is handed
   * back, so a site can never end up holding a public key whose private half
   * was lost.
   */
  async register(
    request: RegistrationRequest
  ): Promise<{ record: PasskeyRecord; response: RegistrationResponse }> {
    const { passkey, response } = createPasskey(request);
    const item = await this.vault.createItem(
      'passkey',
      `${request.userName} @ ${request.rpId}`
    );
    await this.write(item.id, passkey);
    return { record: await this.read(item), response };
  }

  async list(rpId?: string): Promise<PasskeyRecord[]> {
    const items = await this.vault.listItems({ kind: 'passkey' });
    const records = await Promise.all(items.map((item) => this.read(item)));
    return rpId ? records.filter((record) => record.rpId === rpId) : records;
  }

  /**
   * Sign a site's challenge, and persist the advanced sign count before
   * returning: a site that later sees the count fail to advance concludes the
   * key was cloned, so losing the write is worse than losing the assertion.
   */
  async assert(itemId: string, request: AssertionRequest): Promise<AssertionResponse> {
    const passkey = await this.reveal(itemId);
    const assertion = assertPasskey(passkey, request);
    await this.vault.setField(
      itemId,
      FIELDS.signCount,
      'text',
      String(assertion.passkey.signCount),
      false
    );
    return assertion.response;
  }

  /** Delete the key. The site keeps its credential; it will simply never match. */
  async forget(itemId: string): Promise<void> {
    await this.vault.deleteItemForever(itemId);
  }

  private async write(itemId: string, passkey: Passkey): Promise<void> {
    await this.vault.setField(itemId, FIELDS.rpId, 'url', passkey.rpId, false);
    await this.vault.setField(itemId, FIELDS.credentialId, 'text', passkey.credentialId, false);
    await this.vault.setField(itemId, FIELDS.userHandle, 'text', passkey.userHandle, false);
    await this.vault.setField(itemId, FIELDS.userName, 'username', passkey.userName, false);
    await this.vault.setField(itemId, FIELDS.signCount, 'text', String(passkey.signCount), false);
    await this.vault.setField(itemId, FIELDS.privateKey, 'private_key', passkey.privateKey);
  }

  /** The whole passkey, private key and all — only used to sign. */
  private async reveal(itemId: string): Promise<Passkey> {
    const item = await this.vault.getItem(itemId);
    if (!item || item.kind !== 'passkey') {
      throw new PasskeyError(`item ${itemId} is not a passkey`);
    }
    const record = await this.read(item);
    return {
      credentialId: record.credentialId,
      rpId: record.rpId,
      privateKey: await this.vault.revealField(itemId, FIELDS.privateKey),
      userHandle: await this.vault.revealField(itemId, FIELDS.userHandle),
      userName: record.userName,
      signCount: record.signCount,
    };
  }

  private async read(item: VaultItem): Promise<PasskeyRecord> {
    const value = async (name: string) => this.vault.revealField(item.id, name);
    return {
      itemId: item.id,
      rpId: await value(FIELDS.rpId),
      credentialId: await value(FIELDS.credentialId),
      userName: await value(FIELDS.userName),
      signCount: Number(await value(FIELDS.signCount)),
      createdAt: item.createdAt,
    };
  }
}
