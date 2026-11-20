import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * The BYOK vault: AES-256-GCM, key derived from ARIS_KEY_SECRET.
 * Format `v1:<iv b64>:<tag b64>:<ct b64>`. Decryption throws on a wrong
 * secret or any tampering (GCM auth tag).
 */
const SALT = 'beuk-aris-vault';

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, SALT, 32);
}

export function encryptKey(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decryptKey(secret: string, ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('unrecognised vault format');
  const [, iv, tag, ct] = parts;
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}
