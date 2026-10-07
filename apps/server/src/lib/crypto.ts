import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'node:crypto';
export const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function encrypt(value: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((x) => x.toString('base64'))
    .join(':');
}
export function decrypt(value: string, key: string): string {
  const [iv, tag, data] = value.split(':').map((x) => Buffer.from(x, 'base64'));
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'base64'),
    iv,
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  );
}
