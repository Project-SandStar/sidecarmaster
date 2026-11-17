import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createApp, createMode, deleteMode, seedRegistry, updateMode } from '@/lib/control/registry';
import { setHostApp, setRole, updateHost } from '@/lib/control/roles';
import { buildHostPolicy, enforceMinOnline, pushConfig } from '@/lib/control/policy';
import { diffHost, MAX_TRIES, reconcileOnce } from '@/lib/control/reconcile';
import { appFleetView, modeCatalog } from '@/lib/control/fleet-view';
import { ControlError } from '@/lib/control/errors';
import { InMemoryCommandSender, InMemoryFleet, setFleetStatus, type HostLive } from '@/lib/fleet/interfaces';

let linux: string, mac: string;
const fleet = new InMemoryFleet();

const live = (hostId: string, name: string, containers: HostLive['containers'] = []): HostLive =>
  ({ hostId, name, online: true, lastHeartbeatAt: new Date(), containers });

beforeAll(async () => {
  const s = await seedRegistry();
  expect(s.apps).toBe(6);
  linux = (await prisma.host.create({ data: { name: 'gpu-linux', os: 'linux', agentUrl: 'http://10.0.0.1:8098' } })).id;
  mac = (await prisma.host.create({ data: { name: 'mac-1', os: 'darwin', agentUrl: 'http://10.0.0.2:8098' } })).id;
  setFleetStatus(fleet);
});

beforeEach(() => { fleet.set(live(linux, 'gpu-linux')); fleet.set(live(mac, 'mac-1')); });

describe('registry (3.1)', () => {
  it('seeds the six apps and Fantom has its own embedding mode', async () => {
    const apps = (await prisma.app.findMany()).map((a) => a.id).sort();
    expect(apps).toEqual(['axon', 'expedat', 'fantom', 'quickbooks', 'soundsuite', 'spam'].sort());
    expect(await prisma.appMode.findFirst({ where: { appId: 'fantom', name: 'fantom-code-embedding' } })).toBeTruthy();
    expect((await seedRegistry()).modes).toBe(0); // idempotent
  });

  it('refuses a mode on a port another mode uses on the same OS', async () => {
    await createApp({ id: 'axon2', displayName: 'Axon 2' });
    await expect(createMode('axon2', { name: 'axon2-embed', port: 11437 })).rejects.toThrow(/Port 11437/);
    const m = await createMode('axon2', { name: 'axon2-embed', port: 11500, defaultModels: { default: 'nomic-embed-text' }, env: { OLLAMA_KEEP_ALIVE: '5m' } });
    expect(m.defaultModel).toBe('nomic-embed-text');
    await expect(updateMode('axon2', 'axon2-embed', { port: 11436 })).rejects.toThrow(ControlError);
    await expect(createMode('axon2', { name: 'axon2-x', kind: 'bogus' })).rejects.toThrow(/kind/);
  });
});

describe('roles and provisioning (3.2)', () => {
  it('refuses a mode the host OS cannot run', async () => {
    await expect(setRole(mac, 'soundsuite', 'ss-reranker', { enabled: true })).rejects.toThrow(/not available/);
  });
  it('refuses a runtime the mode does not allow', async () => {
    await expect(setRole(linux, 'soundsuite', 'ss-rlm-sandbox', { enabled: true, runtime: 'host' })).rejects.toThrow(/does not run/);
  });
  it('setRole adds the HostApp row and bumps policyRev', async () => {
    const before = (await prisma.host.findUnique({ where: { id: linux } }))!.policyRev;
    await setRole(linux, 'soundsuite', 'ss-ocr', { enabled: true, minOnline: 1, idleTimeoutMin: 10 });
    expect(await prisma.hostApp.findUnique({ where: { hostId_appId: { hostId: linux, appId: 'soundsuite' } } })).toBeTruthy();
    expect((await prisma.host.findUnique({ where: { id: linux } }))!.policyRev).toBeGreaterThan(before);
  });
  it('host updates validate the OS override', async () => {
    await expect(updateHost(linux, { hostOsOverride: 'beos' })).rejects.toThrow(/hostOsOverride/);
    await expect(setHostApp(linux, 'soundsuite', { wsPortOverride: 70000 })).rejects.toThrow(/wsPortOverride/);
  });
});

describe('policy and push (3.3)', () => {
  it('builds the config: per-role registry, ms idle timeouts, Mac host runtime port', async () => {
    await setRole(linux, 'fantom', 'fantom-code-embedding', { enabled: true, minOnline: 1 });
    await setRole(mac, 'soundsuite', 'ss-embedding', { enabled: true, minOnline: 1 });
    const p = (await buildHostPolicy(linux))!;
    expect(p.config.registry.ocr).toMatchObject({ port: 11436, containerName: 'ss-ocr', appId: 'soundsuite' });
    expect(p.config.registry['fantom-code-embedding']).toMatchObject({ port: 11438, appId: 'fantom' });
    expect(p.config.idleTimeouts.ocr).toBe(600_000);
    const m = (await buildHostPolicy(mac))!;
    expect(m.config.registry.embedding).toMatchObject({ image: 'host-ollama', port: 11434, runtime: 'host' });
  });

  it('never sends a sidecar token over ws://', async () => {
    await prisma.app.update({ where: { id: 'soundsuite' }, data: { wsUrl: 'ws://10.0.0.9:3001' } });
    const { updateApp } = await import('@/lib/control/registry');
    await updateApp('soundsuite', { sidecarToken: 'very-secret-token' });
    let p = (await buildHostPolicy(linux))!;
    expect(JSON.stringify(p.config)).not.toContain('very-secret-token');
    await updateApp('soundsuite', { wsUrl: 'wss://ss.example:3001' });
    p = (await buildHostPolicy(linux))!;
    expect(p.config.masters.find((x) => x.appId === 'soundsuite')?.token).toBe('very-secret-token');
  });

  it('push without relay is skipped; with sender it marks pushedPolicyRev', async () => {
    expect((await pushConfig(linux, null)).skipped).toBe('no-relay');
    const s = new InMemoryCommandSender();
    expect((await pushConfig(linux, s)).ok).toBe(true);
    expect(s.calls[0].command).toBe('config');
    const h = (await prisma.host.findUnique({ where: { id: linux } }))!;
    expect(h.pushedPolicyRev).toBe(h.policyRev);
  });

  it('min-online starts a role that runs nowhere', async () => {
    const s = new InMemoryCommandSender();
    const r = await enforceMinOnline(s);
    expect(r.started.some((x) => x.includes('ss-ocr'))).toBe(true);
    expect(s.calls.every((c) => c.command === 'start')).toBe(true);
  });
});

describe('reconcile (3.4)', () => {
  it('diffHost: start missing, stop unwanted, ignore foreign containers', () => {
    const known = new Map([['ocr', { appId: 'soundsuite', mode: 'ss-ocr' }], ['completion', { appId: 'soundsuite', mode: 'ss-completion' }]]);
    const f = diffHost(live('h', 'h', [
      { name: 'ss-completion', role: 'completion', state: 'running' },
      { name: 'postgres', role: 'db', state: 'running' },
    ]), [{ appId: 'soundsuite', mode: 'ss-ocr', role: 'ocr', enabled: true, minOnline: 1 }], false, known);
    expect(f.map((x) => `${x.action}:${x.role}`).sort()).toEqual(['start:ocr', 'stop:completion']);
  });

  it('pushes then starts; gives up after MAX_TRIES failures; audits each try', async () => {
    await prisma.host.update({ where: { id: mac }, data: { reconcileEnabled: false } });
    const failing = new InMemoryCommandSender((_h, cmd) => (cmd === 'start' ? { ok: false, error: 'no vram' } : { ok: true }));
    for (let i = 0; i < MAX_TRIES; i++) await reconcileOnce(failing);
    const r = await reconcileOnce(failing);
    expect(r.gaveUp.some((f) => f.mode === 'ss-ocr')).toBe(true);
    expect(failing.calls.filter((c) => c.command === 'start' && c.payload.role === 'ocr')).toHaveLength(MAX_TRIES);
    expect(await prisma.auditLog.count({ where: { actor: 'reconcile', action: 'reconcile.give-up' } })).toBeGreaterThan(0);
    // Fix works once the role runs: state is cleared.
    fleet.set(live(linux, 'gpu-linux', [
      { name: 'ss-ocr', role: 'ocr', state: 'running' },
      { name: 'fantom-code-embedding', role: 'fantom-code-embedding', state: 'running' },
    ]));
    const ok = await reconcileOnce(failing);
    expect(ok.fixes).toHaveLength(0);
    expect(await prisma.reconcileState.count({ where: { hostId: linux } })).toBe(0);
  });

  it('skips without a relay', async () => expect((await reconcileOnce(null)).skipped).toBe('no-relay'));
});

describe('read models (3.5, 3.7)', () => {
  it('app fleet view lists only the app hosts with live state', async () => {
    const v = (await appFleetView('fantom'))!;
    expect(v.hosts.map((h) => h.name)).toEqual(['gpu-linux']);
    expect(v.hosts[0].roles[0]).toMatchObject({ mode: 'fantom-code-embedding', port: 11438 });
  });
  it('mode catalog per OS drops Linux-only modes on Mac and uses host-ollama', async () => {
    const c = await modeCatalog('mac-docker-ollama');
    expect(c.registry.reranker).toBeUndefined();
    expect(c.registry.embedding).toMatchObject({ image: 'host-ollama', port: 11434 });
    expect((await modeCatalog('linux')).registry.reranker).toMatchObject({ port: 8099, type: 'vllm' });
  });
  it('deleteMode refuses an enabled mode', async () => {
    await expect(deleteMode('soundsuite', 'ss-ocr')).rejects.toThrow(/enabled/);
  });
});
