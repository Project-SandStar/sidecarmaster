import { beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { ensureFirstAdmin } from '@/lib/auth';
import { seedRegistry } from '@/lib/control/registry';
import { knownRoles, runReconcilePass } from '@/lib/control/reconcile';
import { planFleet, previewReconcile, stopList, type PlanHostInput } from '@/lib/control/reconcile-plan';
import {
  PREVIEW_MAX_AGE_MS, envLocksReconcile, previewIsFresh, reconcileOff, reconcileSwitch, setReconcileEnabled,
} from '@/lib/control/reconcile-switch';
import { InMemoryCommandSender, InMemoryFleet, setFleetStatus, type HostLive } from '@/lib/fleet/interfaces';

let cookie: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === 'sm_session' && cookie ? { value: cookie } : undefined) }),
}));
const req = (method: string, body?: unknown) => new Request('http://x/api', {
  method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});

const known = new Map([
  ['ocr', { appId: 'soundsuite', mode: 'ss-ocr' }],
  ['embedding', { appId: 'soundsuite', mode: 'ss-embedding' }],
  ['reranker', { appId: 'soundsuite', mode: 'ss-reranker' }],
  ['completion', { appId: 'soundsuite', mode: 'ss-completion' }],
]);
const host = (o: Partial<PlanHostInput>): PlanHostInput => ({
  hostId: 'h1', name: 'BOX', online: true, reconcileEnabled: true, policyRev: 1, pushedPolicyRev: 1, containers: [], desired: [], ...o,
});
const ss = (mode: string, minOnline = 1, enabled = true) => ({ appId: 'soundsuite', mode, role: mode.replace(/^ss-/, ''), enabled, minOnline });

describe('dry-run planner', () => {
  it('assigned+running = keep, assigned+missing = start, unassigned+running = stop', () => {
    const p = planFleet([host({
      desired: [ss('ss-ocr'), ss('ss-completion')],
      containers: [
        { name: 'ss-ocr', role: 'ocr', state: 'running' },
        { name: 'ss-embedding', role: 'embedding', state: 'running' },
        { name: 'postgres', role: 'db', state: 'running' },
      ],
    })], known);
    const by = Object.fromEntries(p.hosts[0].items.map((x) => [x.role, x.action]));
    expect(by).toEqual({ ocr: 'keep', completion: 'start', embedding: 'stop', db: 'leave' });
    expect(p.totals).toMatchObject({ start: 1, stop: 1, push: 0 });
    expect(stopList(p)).toEqual(['BOX ss-embedding']);
  });

  it('created-but-not-started: assigned → start, not assigned → left alone', () => {
    const p = planFleet([host({
      desired: [ss('ss-ocr')],
      containers: [{ name: 'ss-ocr', role: 'ocr', state: 'created' }, { name: 'ss-reranker', role: 'reranker', state: 'created' }],
    })], known);
    const by = Object.fromEntries(p.hosts[0].items.map((x) => [x.role, x]));
    expect(by.ocr.action).toBe('start');
    expect(by.ocr.why).toMatch(/created/);
    expect(by.reranker.action).toBe('leave');
    expect(p.totals.stop).toBe(0);
  });

  it('config push when the policy changed; reconfigure when the model differs', () => {
    const p = planFleet([host({
      policyRev: 3, pushedPolicyRev: 2,
      desired: [{ ...ss('ss-ocr'), model: 'new-model' }],
      containers: [{ name: 'ss-ocr', role: 'ocr', state: 'running', model: 'old-model' }],
    })], known);
    expect(p.hosts[0].push).toEqual({ rev: 3, pushedRev: 2 });
    expect(p.hosts[0].items[0]).toMatchObject({ action: 'reconfigure' });
    expect(p.totals.push).toBe(1);
  });

  it('minOnline 0 is on demand; offline hosts and host flag off do nothing but min-online', () => {
    const p = planFleet([
      host({ hostId: 'a', name: 'A', desired: [ss('ss-ocr', 0)] }),
      host({ hostId: 'b', name: 'B', online: false, desired: [ss('ss-ocr')], containers: [{ name: 'ss-embedding', role: 'embedding', state: 'running' }] }),
      host({ hostId: 'c', name: 'C', reconcileEnabled: false, policyRev: 5, desired: [ss('ss-completion')], containers: [{ name: 'ss-embedding', role: 'embedding', state: 'running' }] }),
    ], known);
    const [a, b, c] = p.hosts;
    expect(a.items[0].action).toBe('on-demand');
    expect(b.skipped).toMatch(/offline/);
    expect(b.items).toEqual([]);
    expect(c.push).toBeNull();
    expect(c.items.find((x) => x.role === 'embedding')!.action).toBe('leave');
    // The min-online rule still starts completion on C (it ignores the host flag).
    expect(c.items.find((x) => x.role === 'completion')!.action).toBe('start');
  });

  it('a mode already at its min-online count elsewhere is not started again by min-online', () => {
    const p = planFleet([
      host({ hostId: 'a', name: 'A', desired: [ss('ss-ocr')], containers: [{ name: 'ss-ocr', role: 'ocr', state: 'running' }] }),
      host({ hostId: 'b', name: 'B', reconcileEnabled: false, desired: [ss('ss-ocr')] }),
    ], known);
    expect(p.hosts[1].items[0].action).toBe('on-demand');
  });

  it('a fix the loop gave up on shows as gave-up, not start', () => {
    const p = planFleet([host({ desired: [ss('ss-ocr')], gaveUp: new Set(['soundsuite|ss-ocr|start']) })], known);
    expect(p.hosts[0].items[0].action).toBe('gave-up');
    expect(p.totals.start).toBe(0);
  });
});

describe('switch: DB setting + env lock', () => {
  it('defaults to OFF with no row', async () => {
    await prisma.setting.deleteMany({ where: { key: 'reconcile.enabled' } });
    expect(await reconcileOff({})).toBe(true);
    expect((await reconcileSwitch({})).reason).toMatch(/Settings/);
  });
  it('setting on → on; SM_RECONCILE=0 still locks it off', async () => {
    await setReconcileEnabled(true);
    expect(await reconcileOff({})).toBe(false);
    expect(envLocksReconcile({ SM_RECONCILE: '0' })).toBe(true);
    const s = await reconcileSwitch({ SM_RECONCILE: '0' });
    expect(s).toMatchObject({ on: false, setting: true, lockedByEnv: true });
    expect(s.reason).toMatch(/locked off by SM_RECONCILE=0/);
    await setReconcileEnabled(false);
  });
  it('previewIsFresh: same id and younger than the limit', () => {
    const p = { id: 'x', at: new Date(1_000_000).toISOString(), by: 'a', stops: 0, starts: 0, pushes: 0 };
    expect(previewIsFresh(p, 'x', 1_000_000 + 1000)).toBe(true);
    expect(previewIsFresh(p, 'y', 1_000_000 + 1000)).toBe(false);
    expect(previewIsFresh(p, 'x', 1_000_000 + PREVIEW_MAX_AGE_MS + 1)).toBe(false);
    expect(previewIsFresh(null, 'x')).toBe(false);
  });
  it('the real pass does nothing while off', async () => {
    const s = new InMemoryCommandSender(() => ({ ok: true }));
    const r = await runReconcilePass(s);
    expect(r.skipped).toBe('reconcile-off');
    expect(s.calls).toEqual([]);
  });
});

describe('Settings API', () => {
  let hostId = '';
  const fleet = new InMemoryFleet();
  beforeAll(async () => {
    await seedRegistry();
    await ensureFirstAdmin({ SM_ADMIN_USERNAME: 'admin', SM_ADMIN_PASSWORD: 'pw-for-tests' } as unknown as NodeJS.ProcessEnv);
    const { POST } = await import('@/app/api/auth/login/route');
    const r = await POST(req('POST', { username: 'admin', password: 'pw-for-tests' }));
    cookie = /sm_session=([^;]+)/.exec(r.headers.get('set-cookie')!)![1];
    hostId = (await prisma.host.create({ data: { name: 'GPUWS34', os: 'windows' } })).id;
    const { setRole } = await import('@/lib/control/roles');
    await setRole(hostId, 'soundsuite', 'ss-ocr', { enabled: true, minOnline: 1 });
    await prisma.host.update({ where: { id: hostId }, data: { pushedPolicyRev: (await prisma.host.findUnique({ where: { id: hostId } }))!.policyRev } });
    const live: HostLive = { hostId, name: 'GPUWS34', online: true, lastHeartbeatAt: new Date(), containers: [
      { name: 'ss-ocr', role: 'ocr', state: 'running' },
      { name: 'ss-embedding', role: 'embedding', state: 'running' },
      { name: 'ss-cuda', role: 'cuda', state: 'running' },
    ] };
    fleet.set(live);
    setFleetStatus(fleet);
  });

  it('needs a login', async () => {
    const saved = cookie; cookie = undefined;
    const { GET } = await import('@/app/api/settings/reconcile/route');
    expect((await GET()).status).toBe(401);
    cookie = saved;
  });

  it('preview lists the stops on the live host and sends nothing', async () => {
    expect((await knownRoles()).has('embedding')).toBe(true);
    const plan = await previewReconcile();
    const h = plan.hosts.find((x) => x.name === 'GPUWS34')!;
    expect(h.items.filter((x) => x.action === 'stop').map((x) => x.container)).toEqual(['ss-embedding']);
    expect(h.items.find((x) => x.role === 'cuda')!.action).toBe('leave'); // no catalog mode: not ours
    expect(h.items.find((x) => x.role === 'ocr')!.action).toBe('keep');
  });

  it('turning on needs a fresh preview; every change is audited', async () => {
    const api = await import('@/app/api/settings/reconcile/route');
    const prev = await import('@/app/api/settings/reconcile/preview/route');
    expect((await api.PUT(req('PUT', { enabled: true }))).status).toBe(409);
    const p = await (await prev.POST()).json() as { id: string; stopList: string[] };
    expect(p.stopList).toEqual(['GPUWS34 ss-embedding']);
    expect((await api.PUT(req('PUT', { enabled: true, previewId: 'stale' }))).status).toBe(409);
    const on = await api.PUT(req('PUT', { enabled: true, previewId: p.id }));
    expect(on.status).toBe(200);
    expect(await reconcileOff({})).toBe(false);
    expect((await api.PUT(req('PUT', { enabled: false }))).status).toBe(200);
    expect(await reconcileOff({})).toBe(true);
    const acts = (await prisma.auditLog.findMany({ where: { actor: 'admin', action: { startsWith: 'reconcile.' } } })).map((a) => a.action);
    expect(acts).toEqual(expect.arrayContaining(['reconcile.enable.refused', 'reconcile.preview', 'reconcile.enable', 'reconcile.disable']));
  });

  it('SM_RECONCILE=0 refuses turning on even with a fresh preview', async () => {
    const before = process.env.SM_RECONCILE;
    process.env.SM_RECONCILE = '0';
    try {
      const api = await import('@/app/api/settings/reconcile/route');
      const prev = await import('@/app/api/settings/reconcile/preview/route');
      const p = await (await prev.POST()).json() as { id: string };
      const r = await api.PUT(req('PUT', { enabled: true, previewId: p.id }));
      expect(r.status).toBe(409);
      expect(((await r.json()) as { error: string }).error).toMatch(/locked off by SM_RECONCILE=0/);
      const v = await (await api.GET()).json() as { lockedByEnv: boolean; on: boolean };
      expect(v).toMatchObject({ lockedByEnv: true, on: false });
    } finally {
      if (before === undefined) delete process.env.SM_RECONCILE; else process.env.SM_RECONCILE = before;
    }
  });
});
