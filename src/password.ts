import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';

/** Password hashing: argon2id with the library's sane defaults. */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** A real argon2id hash (same parameters as hashPassword) of a random
 *  secret nobody knows, computed once per process. Login verifies an
 *  unknown email against it so that "no such account" spends the same
 *  argon2 work as "wrong password" — the response time no longer tells
 *  an attacker which emails are registered. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('base64url'));
  return dummyHash;
}

/** Spend one argon2 verify that can never succeed. Always false. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  await verifyPassword(await dummyPasswordHash(), password);
  return false;
}
