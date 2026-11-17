import crypto from 'node:crypto';

/** Secrets at rest: AES-256-GCM, key = SHA-256(SM_SECRET_KEY). Format `v1:<iv>:<tag>:<data>` (base64). */
function key(): Buffer {
  const s = process.env.SM_SECRET_KEY;
  if (!s || s.length < 16) throw new Error('SM_SECRET_KEY is not set (16 or more characters)');
  return crypto.createHash('sha256').update(s).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decryptSecret(blob: string): string {
  const [v, iv, tag, data] = blob.split(':');
  if (v !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unknown secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

/** Last 4 characters, or null. The only part of a secret any API returns. */
export function secretHint(s: string | null | undefined): string | null {
  return s ? s.slice(-4) : null;
}

export function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

const SECRET_KEY_RE = /pass|secret|token|setupkey|apikey|key$/i;

/** Copy of an object with secret-looking fields replaced by their hint. For audit rows and logs. */
export function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) && typeof x === 'string' ? (x ? `…${secretHint(x)}` : '') : redact(x);
    }
    return out;
  }
  return v;
}
