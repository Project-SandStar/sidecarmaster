import { describe, expect, it } from 'vitest';
import { buildFleetView, type HostRowInput } from '@/lib/fleet/view';
import type { LiveHostStatus } from '@/lib/relay/live-store';
import { linkSidecar, hostKey } from '@/lib/fleet/host-identity';
import { prisma } from '@/lib/db';

const host = (o: Partial<HostRowInput>): HostRowInput => ({
  id: 'h1', name: 'gpu1', agentUrl: 'http://10.0.0.1:8098', hostname: 'gpu1', lastHeartbeatAt: null, sidecarVersion: null,
  statusSnapshot: null, liveStatus: null, hostOsOverride: null, aliases: [], roles: [], ...o,
});
const live = (o: Partial<LiveHostStatus>): LiveHostStatus => ({
  agentUrl: 'http://10.0.0.1:8098', hostId: null, hostname: 'gpu1', connected: true, transport: 'ws', protocolVersion: 1,
  connectedAt: 1, lastHeartbeatAt: 1000, observedFromIp: null, version: '2.4.1', mode: 'websocket', uptime: 1,
  gpus: [{ index: 0, name: 'RTX', memoryTotal: 24000, memoryUsed: 1000, memoryFree: 23000, temperature: 40 }],
  containers: ['a', 'b'], activeRequests: 0, statusData: null, ...o,
});

describe('fleet view', () => {
  it('joins live status to the host by alias URL and keeps imported hosts', () => {
    const rows = buildFleetView([
      host({ aliases: [{ url: 'http://100.64.0.1:8098' }], roles: [{ mode: 'ss-ocr', enabled: true }] }),
      host({ id: 'h2', name: 'old', agentUrl: 'http://10.0.0.2:8098', hostname: null, statusSnapshot: JSON.stringify({ mode: 'direct', containers: [1] }) }),
    ], [live({ agentUrl: 'http://100.64.0.1:8098' })]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'gpu1', connected: true, version: '2.4.1', containers: 2, rolesOn: ['ss-ocr'], source: 'live', agentUrl: 'http://100.64.0.1:8098' });
    expect(rows[0].gpus[0].name).toBe('RTX');
    expect(rows[1]).toMatchObject({ name: 'old', connected: false, mode: 'direct', containers: 1, source: 'import' });
  });

  it('shows saved relay state after a restart and unknown live sidecars', () => {
    const rows = buildFleetView(
      [host({ liveStatus: JSON.stringify({ version: '2.3', transport: 'ws', gpus: [] }), lastHeartbeatAt: new Date(5000) })],
      [live({ agentUrl: 'http://10.9.9.9:8098', hostname: 'stranger' })],
    );
    expect(rows.find((r) => r.name === 'gpu1')).toMatchObject({ source: 'saved', version: '2.3', lastHeartbeatAt: 5000, connected: false });
    expect(rows.find((r) => r.name === 'stranger')).toMatchObject({ connected: true, hostId: null });
  });
});

describe('host identity', () => {
  it('normalizes hostnames', () => {
    expect(hostKey('MacMini.local ')).toBe('macmini');
    expect(hostKey('unknown')).toBeNull();
    expect(hostKey('')).toBeNull();
  });

  it('links a new URL of a known box to the same host and moves agentUrl', async () => {
    await prisma.hostAlias.deleteMany(); await prisma.host.deleteMany();
    const id1 = await linkSidecar(prisma, { agentUrl: 'http://10.0.0.1:8098', hostname: 'box', source: 'relay' });
    const id2 = await linkSidecar(prisma, { agentUrl: 'http://10.0.0.7:8098/', hostname: 'BOX.local', source: 'relay' });
    expect(id2).toBe(id1);
    const h = await prisma.host.findUniqueOrThrow({ where: { id: id1 }, include: { aliases: true } });
    expect(h.agentUrl).toBe('http://10.0.0.7:8098');
    expect(h.aliases).toHaveLength(2);
    // Coming back on the old URL finds the host by alias.
    expect(await linkSidecar(prisma, { agentUrl: 'http://10.0.0.1:8098', hostname: null, source: 'relay' })).toBe(id1);
  });
});
