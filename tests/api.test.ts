import { beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { ensureFirstAdmin } from '@/lib/auth';

// Route handlers read the cookie through next/headers; feed it from a variable.
let cookie: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === 'sm_session' && cookie ? { value: cookie } : undefined) }),
}));

const json = (body: unknown, method = 'POST') => new Request('http://x/api', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('API', () => {
  beforeAll(async () => {
    await ensureFirstAdmin({ SM_ADMIN_USERNAME: 'admin', SM_ADMIN_PASSWORD: 'pw-for-tests' } as unknown as NodeJS.ProcessEnv);
  });

  it('GET /api/health', async () => {
    const { GET } = await import('@/app/api/health/route');
    const r = await GET();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, db: 'ok', service: 'sidecarmaster' });
  });

  it('settings need a login', async () => {
    cookie = undefined;
    const nb = await import('@/app/api/settings/netbird/route');
    expect((await nb.GET()).status).toBe(401);
    const al = await import('@/app/api/settings/alerts/route');
    expect((await al.PUT(json({ host: 'x' }, 'PUT'))).status).toBe(401);
  });

  it('login: wrong password 401, right password sets a cookie', async () => {
    const { POST } = await import('@/app/api/auth/login/route');
    expect((await POST(json({ username: 'admin', password: 'nope' }))).status).toBe(401);
    const r = await POST(json({ username: 'admin', password: 'pw-for-tests' }));
    expect(r.status).toBe(200);
    const set = r.headers.get('set-cookie')!;
    expect(set).toMatch(/sm_session=/);
    expect(set.toLowerCase()).toContain('httponly');
    cookie = /sm_session=([^;]+)/.exec(set)![1];
  });

  it('NetBird PUT saves, hides the key, writes an audit row without the key', async () => {
    const { PUT, GET } = await import('@/app/api/settings/netbird/route');
    const r = await PUT(json({ setupKey: 'SETUP-KEY-XYZ-5555', hostname: 'sidecarmaster' }, 'PUT'));
    expect(r.status).toBe(200);
    const v = await (await GET()).json();
    expect(v).toMatchObject({ hasKey: true, keyHint: '5555' });
    expect(JSON.stringify(v)).not.toContain('SETUP-KEY');
    const a = await prisma.auditLog.findFirstOrThrow({ where: { action: 'settings.netbird.update' } });
    expect(a.detail).not.toContain('SETUP-KEY');
    expect((await PUT(json({ hostname: 'BAD NAME' }, 'PUT'))).status).toBe(400);
  });

  it('alerts test email without settings gives a clear error', async () => {
    const { POST } = await import('@/app/api/settings/alerts/test/route');
    const r = await POST(json({}));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/SMTP host/);
  });

  it('update feed: 204 when empty, newest build per channel, 400 on bad names', async () => {
    const { GET } = await import('@/app/api/updates/[product]/[platform]/route');
    const call = (p: string, pl: string, q = '') => GET(new Request(`http://x/api/updates/${p}/${pl}${q}`), { params: Promise.resolve({ product: p, platform: pl }) });
    expect((await call('filesystem-sidecar', 'macos')).status).toBe(204);
    const base = { product: 'filesystem-sidecar', platform: 'macos', url: 'https://x/f.zip', sha256: 'a'.repeat(64) };
    await prisma.release.createMany({ data: [
      { ...base, version: '0.1.0', build: 10 },
      { ...base, version: '0.2.0', build: 12, notes: 'What changed.', minOS: '13.0' },
      { ...base, version: '0.3.0', build: 13, channel: 'beta' },
    ] });
    const r = await call('filesystem-sidecar', 'macos');
    expect(await r.json()).toEqual({ version: '0.2.0', build: 12, url: 'https://x/f.zip', sha256: 'a'.repeat(64), notes: 'What changed.', minOS: '13.0' });
    expect((await (await call('filesystem-sidecar', 'macos', '?channel=beta')).json()).build).toBe(13);
    expect((await call('Bad Product', 'macos')).status).toBe(400);
    expect((await call('docker-sidecar', 'linux')).status).toBe(204);
  });
});
