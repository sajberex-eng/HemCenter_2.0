import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { PASSWORD_MIN_LENGTH } from '@hemcenter/shared';

export const hashPassword = (plain: string) => argon2.hash(plain, { type: argon2.argon2id });
export const verifyPassword = (hash: string, plain: string) => argon2.verify(hash, plain).catch(() => false);

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Returns an error code, or null when the password meets the policy. */
export function checkPasswordPolicy(pw: string): string | null {
  if (pw.length < PASSWORD_MIN_LENGTH) return 'PASSWORD_TOO_SHORT';
  if (!/[A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]/.test(pw) || !/\d/.test(pw)) return 'PASSWORD_NEEDS_LETTER_AND_DIGIT';
  return null;
}
