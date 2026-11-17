/**
 * Relay -> DB. On register (and on the first heartbeat of an unlinked URL) link the URL to a
 * Host row (alias list). On heartbeat, save lastHeartbeatAt / version / liveStatus at most once
 * per SM_HEARTBEAT_PERSIST_MS per URL, so 5 hosts x 15 s heartbeats do not hammer SQLite.
 */
import { prisma } from '../db';
import { linkSidecar } from '../fleet/host-identity';
import type { LiveHostStatus } from './live-store';
import { reportedOs } from '../fleet/relay-adapter';

const PERSIST_MS = Number(process.env.SM_HEARTBEAT_PERSIST_MS ?? 60_000);
const g = globalThis as unknown as { __smPersistAt?: Map<string, number> };
const lastWrite: Map<string, number> = (g.__smPersistAt ??= new Map());
const lastVersion = new Map<string, string | null>();

/** Compact JSON for Host.liveStatus (what the fleet page shows after a restart). */
export function liveStatusJson(s: LiveHostStatus): string {
  return JSON.stringify({
    agentUrl: s.agentUrl, transport: s.transport, protocolVersion: s.protocolVersion, version: s.version, mode: s.mode,
    uptime: s.uptime, containers: s.containers, activeRequests: s.activeRequests, observedFromIp: s.observedFromIp,
    gpus: s.gpus.map((x) => ({ index: x.index, name: x.name, memoryTotal: x.memoryTotal, memoryUsed: x.memoryUsed, memoryFree: x.memoryFree, temperature: x.temperature })),
  });
}

export async function persistSeen(s: LiveHostStatus, kind: 'register' | 'heartbeat', now = Date.now()): Promise<string | null> {
  let hostId = s.hostId;
  if (kind === 'register' || !hostId) {
    hostId = await linkSidecar(prisma, { agentUrl: s.agentUrl, hostname: s.hostname, source: 'relay' }, new Date(now));
  }
  const last = lastWrite.get(s.agentUrl) ?? 0;
  const versionChanged = (lastVersion.get(s.agentUrl) ?? null) !== (s.version ?? null);
  if (kind === 'register' || versionChanged || now - last >= PERSIST_MS) {
    lastWrite.set(s.agentUrl, now);
    lastVersion.set(s.agentUrl, s.version ?? null);
    await prisma.host.update({
      where: { id: hostId },
      data: {
        lastHeartbeatAt: new Date(s.lastHeartbeatAt ?? now),
        sidecarVersion: s.version ?? undefined,
        lastSeenFromIp: s.observedFromIp ?? undefined,
        liveStatus: liveStatusJson(s),
        os: reportedOs(s.statusData ?? {}) ?? undefined,
      },
    });
  }
  return hostId;
}

export function __resetPersist(): void { lastWrite.clear(); lastVersion.clear(); }
