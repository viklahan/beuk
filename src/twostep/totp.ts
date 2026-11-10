import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Two-step sign-in, the pure parts (node:crypto only).
 *
 * TOTP, RFC 6238: HMAC-SHA1, 6 digits, a 30-second step, T0 = 0
 * (https://www.rfc-editor.org/rfc/rfc6238, with the HOTP truncation of
 * RFC 4226 section 5.3). The secret is 20 random bytes, written as RFC
 * 4648 base32 without padding for authenticator apps.
 *
 * Recovery codes: 10 codes of 10 characters from RECOVERY_ALPHABET,
 * shown as XXXXX-XXXXX, stored only as SHA-256 of the normalized code.
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_SECRET_BYTES = 20;
/** The steps a code may come from, relative to the current one. */
export const TOTP_WINDOW = [-1, 0, 1] as const;

export const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_LENGTH = 10;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, uppercase, no padding. */
export function base32Encode(b: Buffer): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of b) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** RFC 4648 base32; ignores case, spaces, dashes and '=' padding. Throws on any other character. */
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error('not base32');
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

/** The 30-second step a moment falls in (T0 = 0). */
export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** The 6-digit code for one step (RFC 4226 dynamic truncation). */
export function totpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** Constant-time comparison of two equal-length codes. */
export function codesEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A new TOTP secret, base32. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

/** The otpauth:// URI authenticator apps read (from the QR code or by hand). */
export function otpauthUri(email: string, secretB32: string): string {
  return `otpauth://totp/Beuk:${encodeURIComponent(email)}?secret=${secretB32}&issuer=Beuk&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

/** Ten fresh recovery codes, XXXXX-XXXXX (distinct). */
export function newRecoveryCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < RECOVERY_CODE_COUNT) {
    let raw = '';
    for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    codes.add(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return [...codes];
}

/** What a recovery code is compared as: uppercase, with spaces and dashes removed. */
export function normalizeRecovery(s: string): string {
  return s.toUpperCase().replace(/[\s-]/g, '');
}

/** What is stored for a recovery code: lowercase-hex SHA-256 of the normalized code. */
export function recoveryHash(code: string): string {
  return createHash('sha256').update(normalizeRecovery(code)).digest('hex');
}
