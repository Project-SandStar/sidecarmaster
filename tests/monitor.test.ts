import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { pruneSamples, recordSamples, rollupHours } from '@/lib/monitor/samples';
import { renderMetrics } from '@/lib/monitor/metrics';
import { buildGrid } from '@/lib/dashboard';
import type { HostLive } from '@/lib/fleet/interfaces';

const H = Date.UTC(2026, 9, 30, 10, 0, 0);
const h = (over: Partial<HostLive> = {}): HostLive => ({
  hostId: 'h1', name: 'gpu-1', online: true, lastHeartbeatAt: new Date(H), activeRequests: 2, diskFreePct: 40,
  gpus: [{ index: 0, name: 'L40', memoryTotalMb: 1000, memoryUsedMb: 500 }], versions: { 'docker-sidecar': '2.5.0' },
  containers: [{ name: 'ss-whisper', role: 'ss-whisper', state: 'running' }], ...over,
});

describe('samples', () => {
  it('records, rolls up per hour, prunes', async () => {
    await recordSamples([h()], new Date(H + 60_000));
    await recordSamples([h({ activeRequests: 6, gpus: [{ index: 0, name: 'L40', memoryTotalMb: 1000, memoryUsedMb: 900 }] })], new Date(H + 120_000));
    await recordSamples([h({ online: false, activeRequests: null })], new Date(H + 180_000));
    expect(await rollupHours(new Date(H + 3_700_000))).toBe(1);
    const r = await prisma.heartbeatHourly.findFirstOrThrow({ where: { hostId: 'h1' } });
    expect(r).toMatchObject({ samples: 3, onlineSamples: 2, avgActiveRequests: 4, maxActiveRequests: 6, maxVramPct: 90, minDiskFreePct: 40 });
    expect(await rollupHours(new Date(H + 3_700_000))).toBe(1); // idempotent
    expect(await prisma.heartbeatHourly.count()).toBe(1);
    const p = await pruneSamples(new Date(H + 8 * 24 * 3600_000));
    expect(p.samples).toBe(3);
  });
});

describe('metrics', () => {
  it('renders Prometheus text', () => {
    const t = renderMetrics({ hosts: [h({ name: 'gpu "1"' })], apps: [{ appId: 'soundsuite', ok: true }], alerts: { open: 2, ack: 0 },
      releases: [{ product: 'filesystem-sidecar', platform: 'macos', channel: 'stable', build: 12 }], now: H + 5000 });
    expect(t).toContain('# TYPE sidecarmaster_host_up gauge');
    expect(t).toContain('sidecarmaster_host_up{host="gpu \\"1\\"",host_id="h1"} 1');
    expect(t).toContain('sidecarmaster_host_heartbeat_age_seconds{host="gpu \\"1\\"",host_id="h1"} 5');
    expect(t).toContain('sidecarmaster_host_vram_used_mb{host="gpu \\"1\\"",host_id="h1"} 500');
    expect(t).toContain('sidecarmaster_alerts{state="open"} 2');
    expect(t).toContain('sidecarmaster_release_latest_build{product="filesystem-sidecar",platform="macos",channel="stable"} 12');
  });
});

describe('dashboard grid', () => {
  it('maps containers to apps and marks down hosts', () => {
    const apps = [{ id: 'soundsuite', displayName: 'Sound Suite', masterUrl: null, wsUrl: null, protocol: 'v1', enabled: true, modes: [] }];
    const g = buildGrid([h(), h({ hostId: 'h2', name: 'gpu-2', online: false })], apps, [{ hostId: 'h2', appId: 'soundsuite', mode: 'ss-llm' }]);
    expect(g.h1.soundsuite).toMatchObject({ state: 'running', roles: ['ss-whisper'] });
    expect(g.h2.soundsuite.state).toBe('down');
  });
});
