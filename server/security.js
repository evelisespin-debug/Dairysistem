import crypto from 'node:crypto';

const N = 16384;
export function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(secret), salt, 64, { N });
  return `s1$${salt.toString('hex')}$${h.toString('hex')}`;
}
export function verifySecret(secret, stored) {
  if (!stored) return false;
  const [v, salt, hash] = stored.split('$');
  if (v !== 's1') return false;
  const h = crypto.scryptSync(String(secret), Buffer.from(salt, 'hex'), 64, { N });
  const a = Buffer.from(hash, 'hex');
  return a.length === h.length && crypto.timingSafeEqual(a, h);
}
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const tokenHash = (t) => crypto.createHash('sha256').update(t).digest('hex');
export function randomPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(12), (b) => alphabet[b % alphabet.length]).join('');
}
