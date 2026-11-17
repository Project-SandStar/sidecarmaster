/**
 * Fleet page rows: imported/linked Host rows joined with live relay state.
 * Pure (no DB, no relay), so the page, the SSE route and tests share it.
 */
import type { LiveHostStatus } from '../relay/live-store';
import type { GpuInfo, SidecarStatusData } from '../protocol';
import { normalizeUrl } from '../protocol';
import { hostKey } from './host-identity';
import {
  buildRoleChips, collectErrors, containerNamesOf, reportedOsOf, resolveOs,
  type HostOsView, type RoleAssignmentRow, type RoleChip,
} from './card';

export interface HostRowInput {
  id: string; name: string; agentUrl: string | null; hostname: string | null; os?: string | null;
  lastHeartbeatAt: Date | string | null; sidecarVersion: string | null;
  statusSnapshot: string | null; liveStatus: string | null; hostOsOverride: string | null;
  aliases: Array<{ url: string }>;
  roles: RoleAssignmentRow[];
}

export interface FleetRow {
  hostId: string | null;
  name: string;
  hostname: string | null;
  agentUrl: string | null;
  aliases: string[];
  connected: boolean;
  transport: 'ws' | 'http' | null;
  protocolVersion: number | null;
  /** epoch ms; newest of relay and DB. */
  lastHeartbeatAt: number | null;
  version: string | null;
  mode: string | null;
  os: HostOsView;
  uptime: number | null;
  activeRequests: number | null;
  observedFromIp: string | null;
  dockerMode: string | null;
  gpus: Array<Pick<GpuInfo, 'index' | 'name' | 'memoryTotal' | 'memoryUsed' | 'temperature'>>;
  containers: number | null;
  /** Names of the containers the sidecar reports. */
  containerNames: string[];
  /** Enabled assignments joined with the live containers (one chip per role). */
  roles: RoleChip[];
  /** Errors the sidecar reports in its heartbeat. */
  errors: string[];
  rolesOn: string[];
  hostOsOverride: string | null;
  /** 'live' = relay saw it since start; 'saved' = last saved relay state; 'import' = Sound Suite copy only. */
  source: 'live' | 'saved' | 'import';
}

interface SavedLive {
  transport?: 'ws' | 'http'; protocolVersion?: number; version?: string; mode?: string; uptime?: number;
  activeRequests?: number; observedFromIp?: string; gpus?: GpuInfo[]; containers?: unknown;
}

const ms = (d: Date | string | null): number | null => (d ? new Date(d).getTime() || null : null);
function json<T>(s: string | null): T | null { if (!s) return null; try { return JSON.parse(s) as T; } catch { return null; } }
function count(c: unknown): number | null {
  if (Array.isArray(c)) return c.length;
  if (c && typeof c === 'object') return Object.keys(c).length;
  return null;
}
const str = (x: unknown): string | null => (typeof x === 'string' && x ? x : null);
const gpuView = (g: GpuInfo[] | undefined | null) =>
  (g ?? []).map((x) => ({ index: x.index, name: x.name, memoryTotal: x.memoryTotal, memoryUsed: x.memoryUsed, temperature: x.temperature }));

export function buildFleetView(hosts: HostRowInput[], live: LiveHostStatus[]): FleetRow[] {
  const used = new Set<LiveHostStatus>();
  const rows: FleetRow[] = hosts.map((h) => {
    const urls = new Set([h.agentUrl, ...h.aliases.map((a) => a.url)].filter((u): u is string => !!u).map(normalizeUrl));
    const mine = live.filter((l) => l.hostId === h.id || urls.has(normalizeUrl(l.agentUrl)) || (!!h.hostname && hostKey(l.hostname) === h.hostname));
    mine.forEach((l) => used.add(l));
    const l = mine.sort((a, b) => Number(b.connected) - Number(a.connected) || (b.lastHeartbeatAt ?? 0) - (a.lastHeartbeatAt ?? 0))[0];
    const saved = json<SavedLive>(h.liveStatus);
    const snap = json<{ mode?: string; containers?: unknown }>(h.statusSnapshot);
    const dbHb = ms(h.lastHeartbeatAt);
    const base = {
      hostId: h.id, name: h.name, agentUrl: l?.agentUrl ?? h.agentUrl, aliases: [...urls].sort(),
      rolesOn: h.roles.filter((r) => r.enabled).map((r) => r.mode), hostOsOverride: h.hostOsOverride,
    };
    if (l) {
      const d = l.statusData;
      return {
        ...base, connected: l.connected, transport: l.transport, protocolVersion: l.protocolVersion,
        hostname: l.hostname ?? h.hostname,
        lastHeartbeatAt: Math.max(l.lastHeartbeatAt ?? 0, dbHb ?? 0) || null,
        version: l.version ?? h.sidecarVersion, mode: l.mode, gpus: gpuView(l.gpus),
        os: resolveOs(h.hostOsOverride, reportedOsOf(d) ?? h.os, l.hostname ?? h.hostname ?? h.name),
        uptime: l.uptime, activeRequests: l.activeRequests, observedFromIp: l.observedFromIp, dockerMode: str(d?.dockerMode),
        containers: l.containers.length || count(d?.containers) || 0,
        containerNames: containerNamesOf(d, l.containers), roles: buildRoleChips(d, h.roles), errors: collectErrors(d),
        source: 'live',
      };
    }
    const containers = saved?.containers ?? snap?.containers;
    const stale: SidecarStatusData | null = containers !== undefined ? { containers } : null;
    return {
      ...base, connected: false, transport: saved?.transport ?? null, protocolVersion: saved?.protocolVersion ?? null,
      hostname: h.hostname,
      lastHeartbeatAt: dbHb, version: saved?.version ?? h.sidecarVersion, mode: saved?.mode ?? snap?.mode ?? null,
      gpus: gpuView(saved?.gpus), containers: count(containers),
      os: resolveOs(h.hostOsOverride, h.os, h.hostname ?? h.name),
      uptime: saved?.uptime ?? null, activeRequests: saved?.activeRequests ?? null, observedFromIp: saved?.observedFromIp ?? null, dockerMode: null,
      containerNames: containerNamesOf(null, containers), roles: buildRoleChips(stale, h.roles), errors: [],
      source: saved ? 'saved' : 'import',
    };
  });
  // Live sidecars with no host row yet (link failed or not done yet).
  for (const l of live) {
    if (used.has(l)) continue;
    const d = l.statusData;
    rows.push({
      hostId: l.hostId, name: hostKey(l.hostname) ?? l.agentUrl, hostname: l.hostname, agentUrl: l.agentUrl, aliases: [l.agentUrl],
      connected: l.connected, transport: l.transport, protocolVersion: l.protocolVersion, lastHeartbeatAt: l.lastHeartbeatAt,
      version: l.version, mode: l.mode, gpus: gpuView(l.gpus), containers: l.containers.length, rolesOn: [], hostOsOverride: null,
      os: resolveOs(null, reportedOsOf(d), l.hostname), uptime: l.uptime, activeRequests: l.activeRequests, observedFromIp: l.observedFromIp,
      dockerMode: str(d?.dockerMode), containerNames: containerNamesOf(d, l.containers), roles: buildRoleChips(d, []), errors: collectErrors(d),
      source: 'live',
    });
  }
  return rows.sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
}
