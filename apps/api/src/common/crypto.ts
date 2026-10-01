import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/** Key for secrets stored in the database. Set TOTP_KEY separately so rotating JWT_SECRET does not break 2FA. */
function key(): Buffer {
  const material = process.env.TOTP_KEY ?? process.env.JWT_SECRET;
  if (!material) throw new Error('TOTP_KEY or JWT_SECRET must be set');
  return createHash('sha256').update(`hemcenter:secrets:${material}`).digest();
}

/** AES-256-GCM; output is "iv.tag.ciphertext" (base64url). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(blob: string): string {
  const [iv, tag, ct] = blob.split('.').map((p) => Buffer.from(p, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
