import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { seedRegistry } from '@/lib/control/registry';
import { setRole } from '@/lib/control/roles';
import { appFleetView, hostAliasUrls, hostsView } from '@/lib/control/fleet-view';
import { InMemoryFleet, setFleetStatus } from '@/lib/fleet/interfaces';

/**
 * What Sound Suite reads in follow mode (GET /api/v1/apps/soundsuite/fleet and /api/v1/hosts).
 * Sound Suite keys hosts by sidecar URL, so every alias must be in the answer; the GPU page
 * there shows hostname, version, GPUs and the app's containers.
 */
describe('public fleet view (3.5) for follow mode', () => {
  let hostId: string;
  const fleet = new InMemoryFleet();

  beforeAll(async () => {
    await seedRegistry();
    hostId = (await prisma.host.create({
      data: {
        name: 'GPUWS34', os: 'linux', agentUrl: 'http://192.168.20.6:8098', hostname: 'gpuws34', sidecarVersion: '2.4.16',
        aliases: { create: [{ url: 'http://100.64.0.6:8098', source: 'relay' }] },
      },
    })).id;
    await setRole(hostId, 'soundsuite', 'ss-ocr', { enabled: true, minOnline: 1 });
    setFleetStatus(fleet);
    fleet.set({
      hostId, name: 'GPUWS34', online: true, lastHeartbeatAt: new Date(), hostname: 'GPUWS34.local', sidecarVersion: '2.4.17', activeRequests: 2,
      gpus: [{ index: 0, name: 'NVIDIA RTX 4090', memoryTotalMb: 24564, memoryUsedMb: 1000 }],
      containers: [
        { name: 'ss-ocr', role: 'ocr', state: 'running', port: 11435 },
        { name: 'fantom-code-embedding', role: 'fantom-code-embedding', state: 'running' },
      ],
    });
  });

  it('app fleet view carries hostname, aliases, version, GPUs and the app containers', async () => {
    const v = (await appFleetView('soundsuite'))!;
    const h = v.hosts.find((x) => x.hostId === hostId)!;
    expect(h).toMatchObject({ hostname: 'GPUWS34.local', sidecarVersion: '2.4.17', activeRequests: 2, online: true });
    expect(h.aliases).toEqual(['http://192.168.20.6:8098', 'http://100.64.0.6:8098']);
    expect(h.gpus[0].name).toBe('NVIDIA RTX 4090');
    expect(h.containers.map((c) => c.name)).toEqual(['ss-ocr']);
    expect(h.roles.find((r) => r.mode === 'ss-ocr')).toMatchObject({ enabled: true, minOnline: 1, running: true });
  });

  it('hosts view has the same identity fields', async () => {
    const h = (await hostsView()).find((x) => x.hostId === hostId)!;
    expect(h.aliases).toContain('http://100.64.0.6:8098');
    expect(h.gpus).toHaveLength(1);
    expect(h.hostname).toBe('GPUWS34.local');
    expect(h.roles).toContainEqual({ appId: 'soundsuite', mode: 'ss-ocr' });
  });

  it('offline host: hostname and version from the DB, no GPUs, no containers', async () => {
    fleet.remove(hostId);
    const h = (await appFleetView('soundsuite'))!.hosts.find((x) => x.hostId === hostId)!;
    expect(h).toMatchObject({ online: false, hostname: 'gpuws34', sidecarVersion: '2.4.16', activeRequests: null, gpus: [], containers: [] });
    expect(h.roles.find((r) => r.mode === 'ss-ocr')!.running).toBe(false);
  });

  it('hostAliasUrls drops trailing slashes and duplicates', () => {
    expect(hostAliasUrls({ agentUrl: 'http://a:1/', aliases: [{ url: 'http://a:1' }, { url: 'http://b:2/' }] })).toEqual(['http://a:1', 'http://b:2']);
    expect(hostAliasUrls({ agentUrl: null })).toEqual([]);
  });
});
