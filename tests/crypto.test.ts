import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, redact, secretHint } from '@/lib/crypto';

describe('secret encryption', () => {
  it('round-trips and uses a new IV each time', () => {
    const a = encryptSecret('hunter2-password');
    const b = encryptSecret('hunter2-password');
    expect(a).not.toBe(b);
    expect(a).not.toContain('hunter2');
    expect(decryptSecret(a)).toBe('hunter2-password');
  });
  it('rejects a changed ciphertext', () => {
    const a = encryptSecret('x').split(':');
    a[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptSecret(a.join(':'))).toThrow();
  });
  it('redacts secret-looking fields', () => {
    const r = redact({ setupKey: 'ABCDEFGH1234', https: { cloudflareToken: 'tok-zzzz9876' }, hostname: 'h', password: 'pw-abcd' }) as Record<string, unknown>;
    expect(JSON.stringify(r)).not.toMatch(/ABCDEFGH|tok-zzzz|pw-ab/);
    expect(r.setupKey).toBe('…1234');
    expect(r.hostname).toBe('h');
    expect(secretHint('abcdef')).toBe('cdef');
  });
});
