import { beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { ensureFirstAdmin } from '@/lib/auth';
import { seedRegistry } from '@/lib/control/registry';

let cookie: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === 'sm_session' && cookie ? { value: cookie } : undefined) }),
}));

const req = (url: string, method = 'GET', body?: unknown, token?: string) => new Request(`http://x${url}`, {
  method,
  headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const P = <T,>(v: T) => ({ params: Promise.resolve(v) });

let hostId: string;
let token: string;

describe('control API', () => {
  beforeAll(async () => {
    await seedRegistry();
    hostId = (await prisma.host.create({ data: { name: 'h1', os: 'linux' } })).id;
    await ensureFirstAdmin({ SM_ADMIN_USERNAME: 'admin', SM_ADMIN_PASSWORD: 'pw-for-tests' } as unknown as NodeJS.ProcessEnv);
  });

  it('admin routes need a login', async () => {
    const r = await import('@/app/api/apps/route');
    expect((await r.GET()).status).toBe(401);
    expect((await r.POST(req('/api/apps', 'POST', { id: 'x1', displayName: 'X' }))).status).toBe(401);
  });

  it('login', async () => {
    const { POST } = await import('@/app/api/auth/login/route');
    const r = await POST(req('/api/auth/login', 'POST', { username: 'admin', password: 'pw-for-tests' }));
    cookie = /sm_session=([^;]+)/.exec(r.headers.get('set-cookie')!)![1];
  });

  it('create app, edit mode, set role: each writes an audit row', async () => {
    const apps = await import('@/app/api/apps/route');
    expect((await apps.POST(req('/api/apps', 'POST', { id: 'newapp', displayName: 'New' }))).status).toBe(201);
    expect((await apps.POST(req('/api/apps', 'POST', { id: 'newapp', displayName: 'New' }))).status).toBe(409);
    expect((await apps.POST(req('/api/apps', 'POST', { id: 'Bad Id', displayName: 'x' }))).status).toBe(400);
    const modes = await import('@/app/api/apps/[id]/modes/route');
    expect((await modes.POST(req('/x', 'POST', { name: 'newapp-embed', port: 11600 }), P({ id: 'newapp' }))).status).toBe(201);
    const mode = await import('@/app/api/apps/[id]/modes/[name]/route');
    expect((await mode.PUT(req('/x', 'PUT', { port: 11436 }), P({ id: 'newapp', name: 'newapp-embed' }))).status).toBe(409);
    const roles = await import('@/app/api/hosts/[id]/roles/route');
    const r = await roles.PUT(req('/x', 'PUT', { appId: 'newapp', mode: 'newapp-embed', enabled: true, minOnline: 1 }), P({ id: hostId }));
    expect(r.status).toBe(200);
    const actions = (await prisma.auditLog.findMany({ where: { actor: 'admin' } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['app.create', 'mode.create', 'role.set']));
  });

  it('push without relay → 503', async () => {
    // Reconcile defaults to off (push would only save); turn the Settings switch on for this test.
    await (await import('@/lib/control/reconcile-switch')).setReconcileEnabled(true);
    const { POST } = await import('@/app/api/hosts/[id]/push/route');
    expect((await POST(req('/x', 'POST'), P({ id: hostId }))).status).toBe(503);
    await (await import('@/lib/control/reconcile-switch')).setReconcileEnabled(false);
  });

  it('issue token: plain once, hash stored, audit has no token', async () => {
    const { POST } = await import('@/app/api/apps/[id]/token/route');
    const r = await POST(req('/x', 'POST', { scopes: ['fleet:read'] }), P({ id: 'newapp' }));
    expect(r.status).toBe(201);
    token = (await r.json()).token;
    expect(token).toMatch(/^smk_newapp_/);
    const a = await prisma.app.findUnique({ where: { id: 'newapp' } });
    expect(a!.apiTokenHash).not.toContain(token);
    const audits = await prisma.auditLog.findMany({ where: { action: 'app.token.issue' } });
    expect(JSON.stringify(audits)).not.toContain(token);
  });

  it('v1: token reads its app; wrong app or scope → 403; bad token → 401', async () => {
    cookie = undefined;
    const fleet = await import('@/app/api/v1/apps/[id]/fleet/route');
    const ok = await fleet.GET(req('/api/v1/apps/newapp/fleet', 'GET', undefined, token), P({ id: 'newapp' }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).hosts[0].name).toBe('h1');
    expect((await fleet.GET(req('/x', 'GET', undefined, token), P({ id: 'soundsuite' }))).status).toBe(403);
    expect((await fleet.GET(req('/x', 'GET', undefined, 'smk_newapp_wrong'), P({ id: 'newapp' }))).status).toBe(401);
    expect((await fleet.GET(req('/x'), P({ id: 'newapp' }))).status).toBe(401);
    const roles = await import('@/app/api/v1/apps/[id]/roles/route');
    expect((await roles.PUT(req('/x', 'PUT', { hostId, mode: 'newapp-embed', minOnline: 2 }, token), P({ id: 'newapp' }))).status).toBe(403);
    const modes = await import('@/app/api/v1/modes/route');
    const m = await modes.GET(req('/api/v1/modes?os=linux', 'GET', undefined, token));
    expect((await m.json()).registry['fantom-code-embedding'].port).toBe(11438);
  });

  it('v1 write with fleet:write scope works and audits as the app', async () => {
    const { issueAppToken } = await import('@/lib/control/tokens');
    const t = await issueAppToken('newapp', ['fleet:read', 'fleet:write']);
    const roles = await import('@/app/api/v1/apps/[id]/roles/route');
    expect((await roles.PUT(req('/x', 'PUT', { hostId, mode: 'newapp-embed', minOnline: 2 }, t.token), P({ id: 'newapp' }))).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { actor: 'app:newapp', action: 'role.set' } })).toBe(1);
  });
});
