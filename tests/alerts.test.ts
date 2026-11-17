import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { InMemoryFleet, type HostLive } from '@/lib/fleet/interfaces';
import { InMemoryAppRegistry } from '@/lib/apps/interfaces';
import { evaluate, PendingClock, RULE_DEFAULTS, updateRules } from '@/lib/alerts/rules';
import { Cooldown } from '@/lib/alerts/notify';
import { runAlertCycle } from '@/lib/alerts/engine';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 30, 12, 0, 0);
const host = (over: Partial<HostLive> = {}): HostLive => ({ hostId: 'h1', name: 'gpu-1', online: true, lastHeartbeatAt: new Date(T0), ...over });

describe('alert rules', () => {
  it('host down after N min, critical after M min', () => {
    const p = new PendingClock();
    expect(evaluate([host()], [], RULE_DEFAULTS, p, T0 + 30_000)).toEqual([]);
    const w = evaluate([host()], [], RULE_DEFAULTS, p, T0 + 2 * MIN);
    expect(w).toMatchObject([{ rule: 'host-down', severity: 'warning', key: 'host-down:h1' }]);
    expect(evaluate([host()], [], RULE_DEFAULTS, p, T0 + 6 * MIN)[0].severity).toBe('critical');
  });
  it('disk low, failed update, GPU high only after the hold time', () => {
    const p = new PendingClock();
    const h = host({ diskFreePct: 5, update: { product: 'filesystem-sidecar', state: 'failed', error: 'sha mismatch' },
      gpus: [{ index: 0, name: 'L40', memoryTotalMb: 100, memoryUsedMb: 99 }] });
    const rules = (t: number) => evaluate([{ ...h, lastHeartbeatAt: new Date(t) }], [], RULE_DEFAULTS, p, t).map((c) => c.rule).sort();
    expect(rules(T0)).toEqual(['disk-low', 'update-failed']);
    expect(rules(T0 + 11 * MIN)).toEqual(['disk-low', 'gpu-high', 'update-failed']);
  });
  it('app down after the hold time', () => {
    const p = new PendingClock();
    const apps = [{ appId: 'soundsuite', name: 'Sound Suite', ok: false, error: 'HTTP 502' }];
    expect(evaluate([], apps, RULE_DEFAULTS, p, T0)).toEqual([]);
    expect(evaluate([], apps, RULE_DEFAULTS, p, T0 + 3 * MIN)).toMatchObject([{ rule: 'app-down', appId: 'soundsuite' }]);
  });
  it('validates rule settings', async () => {
    await expect(updateRules({ gpuVramPct: 200 })).rejects.toThrow(/gpuVramPct/);
    expect((await updateRules({ cooldownMin: 15 })).cooldownMin).toBe(15);
    await updateRules({ cooldownMin: 30 });
  });
});

describe('alert engine', () => {
  it('opens, emails once, closes with "back up", respects mutes and cool-down', async () => {
    const sent: string[] = [];
    const notifier = { send: async (s: string) => { sent.push(s); } };
    const fleet = new InMemoryFleet([host({ lastHeartbeatAt: new Date(T0) })]);
    const apps = new InMemoryAppRegistry([]);
    const pending = new PendingClock(); const cooldown = new Cooldown();
    const run = (t: number) => runAlertCycle({ fleet, apps, notifier, pending, cooldown, now: () => t });

    let r = await run(T0 + 2 * MIN);
    expect(r.opened).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/WARNING: Sidecar on gpu-1 is down/);
    r = await run(T0 + 3 * MIN); // same condition: no new email
    expect(sent).toHaveLength(1);
    r = await run(T0 + 6 * MIN); // escalates once
    expect(sent[1]).toMatch(/CRITICAL/);
    const a = await prisma.alert.findFirstOrThrow({ where: { key: 'host-down:h1' } });
    expect(a.severity).toBe('critical');

    fleet.set(host({ lastHeartbeatAt: new Date(T0 + 7 * MIN) }));
    r = await run(T0 + 7 * MIN);
    expect(r.closed).toBe(1);
    expect(sent[2]).toMatch(/gpu-1 is back up/);

    // Flap inside the cool-down: alert row opens, no second "down" email.
    fleet.set(host({ lastHeartbeatAt: new Date(T0 + 7 * MIN) }));
    await run(T0 + 9 * MIN);
    expect(sent).toHaveLength(3);

    // Mute: alert still opens, marked muted, no email.
    await prisma.alertMute.create({ data: { rule: 'disk-low', until: new Date(T0 + 999 * MIN), createdBy: 'admin' } });
    fleet.set(host({ hostId: 'h2', name: 'gpu-2', lastHeartbeatAt: new Date(T0 + 60 * MIN), diskFreePct: 2 }));
    fleet.remove('h1');
    await run(T0 + 60 * MIN);
    const d = await prisma.alert.findFirstOrThrow({ where: { key: 'disk-low:h2' } });
    expect(d.muted).toBe(true);
    expect(sent.some((s) => s.includes('Disk'))).toBe(false);
  });
  it('probes app health URLs', async () => {
    const fleet = new InMemoryFleet([]);
    const apps = new InMemoryAppRegistry([{ id: 'courtlens', displayName: 'Court Lens', masterUrl: 'https://cl', wsUrl: null, protocol: 'v1', enabled: true, modes: [] }], { courtlens: 'https://cl/api/health' });
    const urls: string[] = [];
    const r = await runAlertCycle({ fleet, apps, notifier: { send: async () => {} }, probe: async (u) => { urls.push(u); return { ok: false, error: 'HTTP 503' }; }, now: () => T0 });
    expect(urls).toEqual(['https://cl/api/health']);
    expect(r.apps[0]).toMatchObject({ appId: 'courtlens', ok: false });
  });
});
