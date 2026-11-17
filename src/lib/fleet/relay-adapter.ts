/**
 * Glue between the Phase 2 relay and the Phase 3/5 interfaces.
 *  - relayFleetStatus(): Host rows (DB) with live relay state on top. A host the relay has not seen
 *    keeps its Sound Suite import status, so the dashboard still works before task 2.6.
 *  - relayCommandSender(): Phase 3 CommandSender. Only sends to hosts connected to the relay
 *    (fails fast otherwise, so reconcile never queues commands for sidecars that do not know us).
 *  - relayFleetControl(): Phase 5 host buttons mapped to sidecar commands.
 */
import { prisma } from '../db';
import { normalizeUrl, type GpuInfo } from '../protocol';
import type { LiveHostStatus } from '../relay/live-store';
import { hostRowToLive, snapContainers } from './db-status';
import {
  commandSender, fleetStatus,
  type CommandReply, type CommandSender, type FleetControl, type FleetStatus, type GpuLive, type HostAction, type HostLive,
} from './interfaces';

const gpuLive = (g: GpuInfo[]): GpuLive[] =>
  g.map((x) => ({ index: x.index, name: x.name, memoryTotalMb: x.memoryTotal, memoryUsedMb: x.memoryUsed, utilPct: null }));

/** OS the sidecar reports in statusData.host.os (or top-level os), if any. */
export function reportedOs(d: Record<string, unknown>): string | null {
  const h = d.host && typeof d.host === 'object' ? (d.host as Record<string, unknown>) : null;
  const v = h?.os ?? d.os;
  return typeof v === 'string' && v ? v : null;
}

type Row = Awaited<ReturnType<typeof loadRows>>[number];
function loadRows() { return prisma.host.findMany({ orderBy: { name: 'asc' }, include: { aliases: true } }); }

function liveFor(h: Row, live: LiveHostStatus[]): LiveHostStatus | null {
  const urls = new Set([h.agentUrl, ...h.aliases.map((a) => a.url)].filter((u): u is string => !!u).map(normalizeUrl));
  const mine = live.filter((l) => l.hostId === h.id || urls.has(normalizeUrl(l.agentUrl)));
  return mine.sort((a, b) => Number(b.connected) - Number(a.connected) || (b.lastHeartbeatAt ?? 0) - (a.lastHeartbeatAt ?? 0))[0] ?? null;
}

/** HostLive for one DB row plus its live relay entry (if any). */
export function mergeLive(h: Row, l: LiveHostStatus | null): HostLive {
  const base = hostRowToLive(h);
  if (!l) return base;
  const d = l.statusData ?? {};
  const hb = Math.max(l.lastHeartbeatAt ?? 0, base.lastHeartbeatAt?.getTime() ?? 0);
  const containers = d.containers !== undefined ? snapContainers(d.containers) : base.containers;
  return {
    ...base,
    online: l.connected,
    // Sound Suite reads the OS from heartbeat statusData.host.os (fleet-router detectHostOs).
    os: reportedOs(d) ?? base.os,
    hostname: l.hostname ?? base.hostname,
    lastHeartbeatAt: hb ? new Date(hb) : null,
    sidecarVersion: l.version ?? base.sidecarVersion,
    versions: l.version ? { 'docker-sidecar': l.version } : base.versions,
    uptimeSec: l.uptime,
    address: l.agentUrl,
    activeRequests: l.activeRequests,
    gpus: l.gpus.length ? gpuLive(l.gpus) : base.gpus,
    containers,
    roles: l.mode ? [{ mode: l.mode, activeRequests: l.activeRequests }] : base.roles,
  };
}

export function relayFleetStatus(): FleetStatus {
  return {
    async list() { const live = fleetStatus.list(); return (await loadRows()).map((h) => mergeLive(h, liveFor(h, live))); },
    async get(id) {
      const h = await prisma.host.findUnique({ where: { id }, include: { aliases: true } });
      return h ? mergeLive(h, liveFor(h, fleetStatus.list())) : null;
    },
  };
}

export function relayCommandSender(): CommandSender {
  return {
    async send(hostId, command, payload = {}): Promise<CommandReply> {
      if (!fleetStatus.isConnected({ hostId })) return { ok: false, error: 'host is not connected to the sidecarmaster relay' };
      try {
        const r = await commandSender.send({ hostId }, command, payload, { appId: 'sidecarmaster' });
        return { ok: true, data: r };
      } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    },
  };
}

/** Phase 5 host actions → sidecar commands. Freeze and restart-sidecar have no sidecar command yet. */
const ACTION_COMMAND: Record<HostAction, string | null> = {
  'restart-sidecar': null, update: 'update', provision: 'provision', freeze: null, unfreeze: null,
};

export function relayFleetControl(sender: CommandSender = relayCommandSender()): FleetControl {
  return {
    async run(hostId, action, args = {}) {
      const cmd = ACTION_COMMAND[action];
      if (!cmd) return { ok: false, message: `${action} is not supported by the sidecar yet` };
      const r = await sender.send(hostId, cmd, args);
      return { ok: r.ok, message: r.ok ? `${action} sent` : (r.error ?? 'failed') };
    },
  };
}
