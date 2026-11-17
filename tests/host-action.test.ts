import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { ensureFirstAdmin } from '@/lib/auth';

// Route handlers read the cookie through next/headers; feed it from a variable.
let cookie: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === 'sm_session' && cookie ? { value: cookie } : undefined) }),
}));
const json = (body: unknown) => new Request('http://x/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('host actions while SM_RECONCILE=0', () => {
  let id = '';
  const before = process.env.SM_RECONCILE;
  beforeAll(async () => {
    await ensureFirstAdmin({ SM_ADMIN_USERNAME: 'admin', SM_ADMIN_PASSWORD: 'pw-for-tests' } as unknown as NodeJS.ProcessEnv);
    const { POST } = await import('@/app/api/auth/login/route');
    const r = await POST(json({ username: 'admin', password: 'pw-for-tests' }));
    cookie = /sm_session=([^;]+)/.exec(r.headers.get('set-cookie')!)![1];
    id = (await prisma.host.create({ data: { name: 'box-a', agentUrl: 'http://10.1.1.1:8098' } })).id;
    process.env.SM_RECONCILE = '0';
  });
  afterAll(async () => {
    process.env.SM_RECONCILE = before;
    (await import('@/lib/fleet/interfaces')).setFleetControl(null);
  });

  it('refuses provision (409) before it reaches the relay; update still goes through', async () => {
    const { setFleetControl } = await import('@/lib/fleet/interfaces');
    const calls: string[] = [];
    setFleetControl({ run: async (_h, a) => { calls.push(a); return { ok: true, message: 'sent' }; } });
    const { POST } = await import('@/app/api/hosts/[id]/action/route');
    const ctx = { params: Promise.resolve({ id }) };
    const r = await POST(json({ action: 'provision' }), ctx);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toMatch(/Reconcile is off/);
    expect(calls).toEqual([]);
    const u = await POST(json({ action: 'update' }), ctx);
    expect(u.status).toBe(200);
    expect(calls).toEqual(['update']);
    expect(await prisma.auditLog.count({ where: { action: 'host.provision' } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'host.update' } })).toBe(1);
  });
});
