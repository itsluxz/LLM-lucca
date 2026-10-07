import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, sha256 } from '../lib/crypto.js';
describe('API key encryption', () => {
  it('round trips and uses a new nonce every time', () => {
    const key = randomBytes(32).toString('base64');
    const a = encrypt('secret-api-key', key);
    const b = encrypt('secret-api-key', key);
    expect(a).not.toBe(b);
    expect(decrypt(a, key)).toBe('secret-api-key');
    expect(decrypt(b, key)).toBe('secret-api-key');
  });
  it('rejects tampering', () => {
    const key = randomBytes(32).toString('base64');
    const parts = encrypt('secret', key).split(':');
    parts[2] = Buffer.from('wrong').toString('base64');
    expect(() => decrypt(parts.join(':'), key)).toThrow();
  });
  it('hashes refresh tokens deterministically', () =>
    expect(sha256('abc')).toBe(sha256('abc')));
});
