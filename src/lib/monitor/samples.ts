/**
 * Task 5.2: heartbeat samples. One row per host every 60 s (7-day ring), rolled up to one
 * row per host per hour (kept 90 days). The DB stays bounded: about 5 hosts × 10 080 rows.
 */
import { prisma } from '../db';
import type { HostLive } from '../fleet/interfaces';

export const SAMPLE_KEEP_MS = 7 * 24 * 3600_000;
export const HOURLY_KEEP_MS = 90 * 24 * 3600_000;
const HOUR = 3600_000;

export function vramOf(h: HostLive): { used: number; total: number } | null {
  const g = h.gpus ?? [];
  if (g.length === 0) return null;
  return { used: g.reduce((s, x) => s + (x.memoryUsedMb || 0), 0), total: g.reduce((s, x) => s + (x.memoryTotalMb || 0), 0) };
}
export function vramPct(h: HostLive): number | null {
  const v = vramOf(h);
  return v && v.total > 0 ? (v.used / v.total) * 100 : null;
}
function gpuUtil(h: HostLive): number | null {
  const u = (h.gpus ?? []).map((g) => g.utilPct).filter((x): x is number => typeof x === 'number');
  return u.length ? u.reduce((a, b) => a + b, 0) / u.length : null;
}

/** Write one sample per host. */
export async function recordSamples(hosts: HostLive[], now = new Date()): Promise<number> {
  if (hosts.length === 0) return 0;
  const r = await prisma.heartbeatSample.createMany({
    data: hosts.map((h) => {
      const v = vramOf(h);
      return {
        hostId: h.hostId, at: now, online: h.online,
        activeRequests: h.activeRequests ?? null,
        vramUsedMb: v ? Math.round(v.used) : null, vramTotalMb: v ? Math.round(v.total) : null,
        gpuUtilPct: gpuUtil(h), diskFreePct: h.diskFreePct ?? null,
        containersRunning: h.containers ? h.containers.filter((c) => c.state === 'running').length : null,
      };
    }),
  });
  return r.count;
}

const hourStart = (d: Date) => new Date(Math.floor(d.getTime() / HOUR) * HOUR);

/** Roll up every complete hour that has samples into HeartbeatHourly (idempotent upsert). */
export async function rollupHours(now = new Date()): Promise<number> {
  const end = hourStart(now);
  const rows = await prisma.heartbeatSample.findMany({ where: { at: { lt: end, gte: new Date(end.getTime() - SAMPLE_KEEP_MS) } } });
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.hostId}|${hourStart(r.at).getTime()}`;
    const g = groups.get(k);
    if (g) g.push(r); else groups.set(k, [r]);
  }
  for (const [k, g] of groups) {
    const [hostId, ts] = k.split('|');
    const reqs = g.map((x) => x.activeRequests).filter((x): x is number => x !== null);
    const vp = g.filter((x) => x.vramTotalMb && x.vramUsedMb !== null).map((x) => (x.vramUsedMb! / x.vramTotalMb!) * 100);
    const disk = g.map((x) => x.diskFreePct).filter((x): x is number => x !== null);
    const data = {
      samples: g.length, onlineSamples: g.filter((x) => x.online).length,
      avgActiveRequests: reqs.length ? reqs.reduce((a, b) => a + b, 0) / reqs.length : null,
      maxActiveRequests: reqs.length ? Math.max(...reqs) : null,
      maxVramPct: vp.length ? Math.max(...vp) : null,
      minDiskFreePct: disk.length ? Math.min(...disk) : null,
    };
    const hour = new Date(Number(ts));
    await prisma.heartbeatHourly.upsert({ where: { hostId_hour: { hostId, hour } }, create: { hostId, hour, ...data }, update: data });
  }
  return groups.size;
}

/** Delete samples older than 7 days and hourly rows older than 90 days. */
export async function pruneSamples(now = new Date()): Promise<{ samples: number; hourly: number }> {
  const a = await prisma.heartbeatSample.deleteMany({ where: { at: { lt: new Date(now.getTime() - SAMPLE_KEEP_MS) } } });
  const b = await prisma.heartbeatHourly.deleteMany({ where: { hour: { lt: new Date(now.getTime() - HOURLY_KEEP_MS) } } });
  return { samples: a.count, hourly: b.count };
}

/** Samples for one host for the charts (newest last). */
export async function hostSeries(hostId: string, sinceMs = 24 * HOUR, now = new Date()) {
  return prisma.heartbeatSample.findMany({
    where: { hostId, at: { gte: new Date(now.getTime() - sinceMs) } }, orderBy: { at: 'asc' },
    select: { at: true, online: true, activeRequests: true, vramUsedMb: true, vramTotalMb: true, gpuUtilPct: true },
  });
}
