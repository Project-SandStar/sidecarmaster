/**
 * Fleet interfaces.
 *
 * Part 1 (Phase 2 relay): RelayFleetStatus / RelayHeartbeatSource / RelayCommandSender and the
 * singletons fleetStatus / heartbeatSource / commandSender read the relay's in-memory state.
 * Part 2 (Phase 5 dashboard): FleetStatus / HeartbeatSource / FleetControl over HostLive.
 * Part 3 (Phase 3 control): CommandSender / CommandReply.
 * src/lib/fleet/relay-adapter.ts turns part 1 into parts 2 and 3; instrumentation.ts registers it.
 *
 * Stable interfaces over the sidecar relay. Other phases (control, dashboard) code against
 * these names, not against the relay internals.
 *
 *   import { commandSender, fleetStatus, heartbeatSource } from '@/lib/fleet/interfaces';
 */
import type { LiveHostStatus, HeartbeatEvent } from '../relay/live-store';
import * as store from '../relay/live-store';
import { queueSidecarCommand } from '../relay/command-queue';
import { prisma } from '../db';

export type { LiveHostStatus, HeartbeatEvent, HeartbeatKind, Transport } from '../relay/live-store';
export type { GpuInfo } from '../protocol';

/** Address a host by sidecarmaster Host.id or by a sidecar URL. */
export type HostRef = { hostId: string } | { agentUrl: string };

export interface CommandOptions {
  /** Default 30 000 ms. */
  timeoutMs?: number;
  /** App on whose behalf the command runs (audit). Default 'sidecarmaster'. */
  appId?: string;
  /** Admin username (audit). */
  requestedBy?: string | null;
}

/** Send a command to a host and wait for its reply. WS first, HTTP poll queue as fallback. */
export interface RelayCommandSender {
  /**
   * `action` is a sidecar route, e.g. 'status', 'config', 'containers/start'.
   * Resolves with the sidecar's result; rejects with SidecarError (sidecar said no),
   * a timeout Error, or Error('Unknown host') when the ref matches nothing.
   */
  send(host: HostRef, action: string, payload?: Record<string, unknown>, opts?: CommandOptions): Promise<unknown>;
}

/** Live state of sidecars as the relay sees it (in memory, no DB). */
export interface RelayFleetStatus {
  /** Every sidecar URL seen since start. Several URLs can share one hostId. */
  list(): LiveHostStatus[];
  /** Best live entry for a host: connected first, then newest heartbeat. */
  forHost(hostId: string): LiveHostStatus | null;
  forUrl(agentUrl: string): LiveHostStatus | null;
  isConnected(host: HostRef): boolean;
}

/** Push feed of register / heartbeat / disconnect events. */
export interface RelayHeartbeatSource {
  /** Returns an unsubscribe function. */
  subscribe(listener: (e: HeartbeatEvent) => void): () => void;
}

function best(list: LiveHostStatus[]): LiveHostStatus | null {
  return [...list].sort((a, b) => Number(b.connected) - Number(a.connected) || (b.lastHeartbeatAt ?? 0) - (a.lastHeartbeatAt ?? 0))[0] ?? null;
}

export const fleetStatus: RelayFleetStatus = {
  list: () => store.all(),
  forHost: (hostId) => best(store.all().filter((s) => s.hostId === hostId)),
  forUrl: (agentUrl) => store.get(agentUrl),
  isConnected: (h) => !!('hostId' in h ? fleetStatus.forHost(h.hostId) : store.get(h.agentUrl))?.connected,
};

export const heartbeatSource: RelayHeartbeatSource = { subscribe: (l) => store.subscribe(l) };

export const commandSender: RelayCommandSender = {
  async send(host, action, payload = {}, opts = {}) {
    let url: string | null = null;
    let hostId: string | null = null;
    if ('agentUrl' in host) {
      url = host.agentUrl;
      hostId = store.get(url)?.hostId ?? null;
    } else {
      hostId = host.hostId;
      url = fleetStatus.forHost(hostId)?.agentUrl
        ?? (await prisma.host.findUnique({ where: { id: hostId }, select: { agentUrl: true } }))?.agentUrl ?? null;
    }
    if (!url) throw new Error('Unknown host');
    return queueSidecarCommand(url, action, payload, { hostId, appId: opts.appId, requestedBy: opts.requestedBy, timeoutMs: opts.timeoutMs });
  },
};

// ─── Phase 5 (dashboard): live fleet over HostLive ─────────────────────────
/**
 * Live fleet view used by the dashboard, samples, alerts and /metrics (Phase 5).
 *
 * Phase 2 (relay) owns the real implementation: it calls setFleetStatus() / setFleetControl()
 * at start. Until then the dashboard reads the Host table (Sound Suite import) through
 * dbFleetStatus(). InMemoryFleet is a fake for tests and for Phase 2 to wrap.
 */

export interface GpuLive { index: number; name: string; memoryTotalMb: number; memoryUsedMb: number; utilPct?: number | null }
export interface ContainerLive {
  name: string; state: string; appId?: string | null; role?: string | null; image?: string | null;
  port?: number | null; model?: string | null; restarts?: number | null;
  /** Models the container (or native Ollama) has loaded, from heartbeat containers[role].loadedModels. */
  loadedModels?: { name: string; size?: number | null }[];
}
export interface MasterLink { appId?: string | null; url: string; connected: boolean; lastError?: string | null; since?: Date | null }
export interface RoleLive { appId?: string | null; mode: string; activeRequests: number }
export interface UpdateState { product: string; state: 'ok' | 'downloading' | 'failed'; version?: string | null; error?: string | null; at?: Date | null }

export interface HostLive {
  hostId: string;
  name: string;
  online: boolean;
  lastHeartbeatAt: Date | null;
  os?: string | null;
  /** Hostname as the sidecar reports it (may end in ".local"). */
  hostname?: string | null;
  sidecarVersion?: string | null;
  /** Version per product, e.g. { 'docker-sidecar': '2.5.0', 'filesystem-sidecar': '0.2.0' }. */
  versions?: Record<string, string>;
  uptimeSec?: number | null;
  netbirdIp?: string | null;
  address?: string | null;
  activeRequests?: number | null;
  gpus?: GpuLive[];
  diskFreePct?: number | null;
  containers?: ContainerLive[];
  roles?: RoleLive[];
  masters?: MasterLink[];
  update?: UpdateState | null;
  errors?: string[];
}

/** Read side: current state of every host. */
export interface FleetStatus {
  list(): Promise<HostLive[]>;
  get(hostId: string): Promise<HostLive | null>;
}

/** Push side: the relay calls back on every heartbeat (5 s). */
export interface HeartbeatSource {
  onHeartbeat(cb: (h: HostLive) => void): () => void;
}

export type HostAction = 'restart-sidecar' | 'update' | 'provision' | 'freeze' | 'unfreeze';
export const HOST_ACTIONS: HostAction[] = ['restart-sidecar', 'update', 'provision', 'freeze', 'unfreeze'];

/** Commands to a host. Phase 2/3 provide it; without it the host page shows the buttons as not available. */
export interface FleetControl {
  run(hostId: string, action: HostAction, args?: Record<string, unknown>): Promise<{ ok: boolean; message: string }>;
}

/** In-memory fleet: a fake for tests, and a simple cache Phase 2 can feed. */
export class InMemoryFleet implements FleetStatus, HeartbeatSource {
  private hosts = new Map<string, HostLive>();
  private subs = new Set<(h: HostLive) => void>();
  constructor(initial: HostLive[] = []) { for (const h of initial) this.hosts.set(h.hostId, h); }
  async list() { return [...this.hosts.values()].sort((a, b) => a.name.localeCompare(b.name)); }
  async get(id: string) { return this.hosts.get(id) ?? null; }
  onHeartbeat(cb: (h: HostLive) => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  /** Store a heartbeat and tell the subscribers. */
  heartbeat(h: HostLive) { this.hosts.set(h.hostId, h); for (const s of this.subs) s(h); }
  set(h: HostLive) { this.hosts.set(h.hostId, h); }
  remove(id: string) { this.hosts.delete(id); }
}

const g = globalThis as unknown as { __smFleet?: FleetStatus; __smFleetCtl?: FleetControl | null };

export function setFleetStatus(f: FleetStatus | undefined) { g.__smFleet = f; }
export function setFleetControl(c: FleetControl | null) { g.__smFleetCtl = c; }
export function getFleetControl(): FleetControl | null { return g.__smFleetCtl ?? null; }

/** The registered FleetStatus, or the Host-table fallback. */
export async function getFleetStatus(): Promise<FleetStatus> {
  if (g.__smFleet) return g.__smFleet;
  const { dbFleetStatus } = await import('./db-status');
  return dbFleetStatus();
}

// ─── Phase 3 (control): commands to a sidecar ─────────────────────────────
// Phase 2's relay owns the real CommandSender (it sends a frame on the socket the
// sidecar opened and waits for the reply). Phase 3 only uses this interface.

/** Reply from a sidecar. `ok: false` with `error` when the sidecar refused or timed out. */
export interface CommandReply { ok: boolean; error?: string | null; data?: unknown }

/** Commands Phase 3 sends: 'config' (full policy push), 'start', 'stop', 'status'. */
export type SidecarCommand = 'config' | 'start' | 'stop' | 'status' | (string & {});

export interface CommandSender {
  send(hostId: string, command: SidecarCommand, payload?: Record<string, unknown>): Promise<CommandReply>;
}

/** Fake sender for tests: records each call; `handler` decides the reply. */
export class InMemoryCommandSender implements CommandSender {
  calls: { hostId: string; command: string; payload: Record<string, unknown> }[] = [];
  constructor(private handler: (hostId: string, command: string, payload: Record<string, unknown>) => CommandReply | Promise<CommandReply> = () => ({ ok: true })) {}
  async send(hostId: string, command: SidecarCommand, payload: Record<string, unknown> = {}) {
    this.calls.push({ hostId, command, payload });
    return this.handler(hostId, command, payload);
  }
}

const gc = globalThis as unknown as { __smCmd?: CommandSender | null };
/** Phase 2 calls this at start. Until then Phase 3 control runs in "no relay" mode (writes only). */
export function setCommandSender(s: CommandSender | null) { gc.__smCmd = s; }
export function getCommandSender(): CommandSender | null { return gc.__smCmd ?? null; }
