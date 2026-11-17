/**
 * Live sidecar state in memory (from Sound Suite's status-cache.ts).
 * Keyed by agentUrl (what the sidecar says in `register` / HTTP heartbeat).
 * The relay and the HTTP fallback routes write here; FleetStatus / HeartbeatSource read here.
 */
import type { GpuInfo, ProtocolVersion, SidecarStatusData } from '../protocol';
import { normalizeUrl } from '../protocol';

export type Transport = 'ws' | 'http';

export interface LiveHostStatus {
  agentUrl: string;
  /** sidecarmaster Host.id, once the relay linked this URL to a host row. */
  hostId: string | null;
  hostname: string | null;
  connected: boolean;
  transport: Transport | null;
  protocolVersion: ProtocolVersion;
  connectedAt: number | null;
  lastHeartbeatAt: number | null;
  observedFromIp: string | null;
  version: string | null;
  mode: string | null;
  uptime: number | null;
  gpus: GpuInfo[];
  containers: string[];
  activeRequests: number;
  /** Full last statusData (no secrets are sent in it by the sidecar). */
  statusData: SidecarStatusData | null;
}

export type HeartbeatKind = 'register' | 'heartbeat' | 'disconnect';
export interface HeartbeatEvent { kind: HeartbeatKind; at: number; status: LiveHostStatus }
export type HeartbeatListener = (e: HeartbeatEvent) => void;

/** HTTP-only sidecars count as connected while their last heartbeat is newer than this. */
export const HTTP_STALE_MS = Number(process.env.SM_HTTP_STALE_MS ?? 90_000);

const g = globalThis as unknown as { __smLive?: Map<string, LiveHostStatus>; __smLiveListeners?: Set<HeartbeatListener> };
const live: Map<string, LiveHostStatus> = (g.__smLive ??= new Map());
const listeners: Set<HeartbeatListener> = (g.__smLiveListeners ??= new Set());

function blank(agentUrl: string): LiveHostStatus {
  return {
    agentUrl, hostId: null, hostname: null, connected: false, transport: null, protocolVersion: 1,
    connectedAt: null, lastHeartbeatAt: null, observedFromIp: null, version: null, mode: null, uptime: null,
    gpus: [], containers: [], activeRequests: 0, statusData: null,
  };
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** Copy the fields we show from a heartbeat's statusData. */
export function applyStatusData(s: LiveHostStatus, d: SidecarStatusData | undefined): void {
  if (!d) return;
  s.statusData = d;
  s.version = str(d.version) ?? s.version;
  s.mode = str(d.mode) ?? s.mode;
  s.hostname = str(d.hostname) ?? s.hostname;
  if (typeof d.uptime === 'number') s.uptime = d.uptime;
  if (Array.isArray(d.gpus)) s.gpus = d.gpus;
  if (Array.isArray(d.containerNames)) s.containers = d.containerNames.filter((c): c is string => typeof c === 'string');
}

export function update(agentUrl: string, fn: (s: LiveHostStatus) => void): LiveHostStatus {
  const k = normalizeUrl(agentUrl);
  const s = live.get(k) ?? blank(k);
  fn(s);
  live.set(k, s);
  return s;
}

export function emit(kind: HeartbeatKind, s: LiveHostStatus): void {
  const e: HeartbeatEvent = { kind, at: Date.now(), status: { ...s } };
  for (const l of listeners) {
    try { l(e); } catch (err) { console.warn('[relay] heartbeat listener failed:', err instanceof Error ? err.message : err); }
  }
}

export function subscribe(fn: HeartbeatListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Connected = open WS, or HTTP heartbeat newer than HTTP_STALE_MS. */
function withFreshness(s: LiveHostStatus, now = Date.now()): LiveHostStatus {
  if (s.transport === 'http' && s.connected && (!s.lastHeartbeatAt || now - s.lastHeartbeatAt > HTTP_STALE_MS)) {
    return { ...s, connected: false };
  }
  return { ...s };
}

export function get(agentUrl: string): LiveHostStatus | null {
  const s = live.get(normalizeUrl(agentUrl));
  return s ? withFreshness(s) : null;
}

export function all(): LiveHostStatus[] {
  const now = Date.now();
  return [...live.values()].map((s) => withFreshness(s, now));
}

export function remove(agentUrl: string): void {
  live.delete(normalizeUrl(agentUrl));
}

/** Tests only. */
export function __resetLiveStore(): void {
  live.clear();
  listeners.clear();
}
