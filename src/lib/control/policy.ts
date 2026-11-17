/**
 * Task 3.3: desired policy per host and the config push.
 * Port of court-lens-mcp fleet-router.ts pushFullConfig / pushIdleTimeouts / pushModelRegistry and the
 * min-online loop, made per-app: the registry carries every enabled mode of every app (catalog from AppMode).
 * Commands go through the CommandSender (Phase 2 relay); without one, nothing is sent.
 */
import { prisma } from '../db';
import type { HostOs } from '../apps/catalog';
import { getCommandSender, getFleetStatus, type CommandReply, type CommandSender, type ContainerLive } from '../fleet/interfaces';
import { listModeViews, modelFor, sidecarTokenFor, type ModeView } from './registry';
import { effectiveRuntime, hostOsKind, portForRuntime, roleKey } from './ports';
import { publish } from './events';

export interface RegistryEntry {
  image: string; model: string | null; port: number; vram: number; type: string;
  modes: ('indexing' | 'searching')[]; containerName: string; runtime?: string; env?: Record<string, string>;
  appId: string; mode: string;
}

/** One desired role on a host. */
export interface DesiredRole {
  appId: string; mode: string; role: string; enabled: boolean; minOnline: number; idleTimeoutMin: number;
  model: string | null; runtime: string; port: number | null;
}

export interface HostPolicy {
  hostId: string; rev: number; hostOs: HostOs | null; roles: DesiredRole[];
  /** The `config` frame payload sent to the sidecar. */
  config: {
    idleTimeouts: Record<string, number>; minOnline: Record<string, number>; enabledModes: string[];
    modelOverrides: Record<string, string>; runtimes: Record<string, string>;
    registry: Record<string, RegistryEntry>; hostOsOverride: string | null;
    masters: { appId: string; masterUrl: string | null; wsUrl: string | null; token?: string }[];
    policyRev: number;
  };
}

function registryEntry(m: ModeView, r: DesiredRole): RegistryEntry {
  const host = r.runtime === 'host', dmr = r.runtime === 'docker-model-runner';
  return {
    image: host ? 'host-ollama' : dmr ? 'dmr' : m.image ?? 'ollama/ollama',
    model: r.model, port: r.port ?? 0, vram: m.vramMb ?? 0, type: m.kind,
    modes: m.kind === 'vllm' ? ['searching'] : ['indexing', 'searching'],
    containerName: m.appId === 'soundsuite' ? `ss-${r.role}` : m.name,
    ...(host || dmr ? { runtime: r.runtime } : {}),
    ...(Object.keys(m.env).length ? { env: m.env } : {}),
    appId: m.appId, mode: m.name,
  };
}

/** Desired state for one host, from its role rows and the mode catalog. */
export async function buildHostPolicy(hostId: string): Promise<HostPolicy | null> {
  const h = await prisma.host.findUnique({ where: { id: hostId }, include: { roles: true, apps: { include: { app: true } } } });
  if (!h) return null;
  const hostOs = hostOsKind(h.hostOsOverride ?? h.os);
  const modes = new Map((await listModeViews()).map((m) => [`${m.appId}|${m.name}`, m]));
  const roles: DesiredRole[] = [];
  const registry: Record<string, RegistryEntry> = {};
  for (const r of h.roles) {
    const m = modes.get(`${r.appId}|${r.mode}`);
    if (!m) continue;
    // A mode the host's OS cannot run is left out (Sound Suite filterModesForHost).
    if (hostOs && m.availableOn.length && !m.availableOn.includes(hostOs)) continue;
    const runtime = effectiveRuntime(m, r.runtime, hostOs);
    const d: DesiredRole = {
      appId: r.appId, mode: r.mode, role: roleKey(r.appId, r.mode), enabled: r.enabled, minOnline: r.enabled ? r.minOnline : 0,
      idleTimeoutMin: r.idleTimeoutMin, model: r.modelOverride ?? modelFor(m, hostOs), runtime,
      port: portForRuntime(r.mode, runtime, { [r.mode]: m.port }) ?? null,
    };
    roles.push(d);
    if (d.enabled) registry[d.role] = registryEntry(m, d);
  }
  const enabled = roles.filter((r) => r.enabled);
  const masters = [];
  for (const ha of h.apps.filter((x) => x.enabled && x.app.enabled && x.app.protocol === 'sidecar-v1')) {
    let wsUrl = ha.app.wsUrl;
    if (wsUrl && ha.wsPortOverride) { try { const u = new URL(wsUrl); u.port = String(ha.wsPortOverride); wsUrl = u.toString(); } catch { /* keep */ } }
    const masterUrl = ha.masterUrlOverride ?? ha.app.masterUrl;
    const token = await sidecarTokenFor(ha.appId);
    // Tokens only over TLS (SPEC §10): never in a ws:// master entry.
    masters.push({ appId: ha.appId, masterUrl, wsUrl, ...(token && wsUrl?.startsWith('wss://') ? { token } : {}) });
  }
  return {
    hostId, rev: h.policyRev, hostOs, roles,
    config: {
      idleTimeouts: Object.fromEntries(roles.map((r) => [r.role, r.idleTimeoutMin * 60_000])),
      minOnline: Object.fromEntries(roles.map((r) => [r.role, r.minOnline])),
      enabledModes: enabled.map((r) => r.mode),
      modelOverrides: Object.fromEntries(enabled.filter((r) => r.model).map((r) => [r.mode, r.model!])),
      runtimes: Object.fromEntries(enabled.map((r) => [r.mode, r.runtime])),
      registry, hostOsOverride: h.hostOsOverride, masters, policyRev: h.policyRev,
    },
  };
}

export interface PushResult { hostId: string; ok: boolean; error?: string; skipped?: 'no-relay' | 'offline' | 'no-host' }

/** Send the full config to one host. Marks pushedPolicyRev on success. */
export async function pushConfig(hostId: string, sender: CommandSender | null = getCommandSender()): Promise<PushResult> {
  if (!sender) return { hostId, ok: false, skipped: 'no-relay' };
  const p = await buildHostPolicy(hostId);
  if (!p) return { hostId, ok: false, skipped: 'no-host' };
  let reply: CommandReply;
  try { reply = await sender.send(hostId, 'config', p.config); } catch (e) { reply = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  if (reply.ok) {
    await prisma.host.update({ where: { id: hostId }, data: { pushedPolicyRev: p.rev, lastConfigPushAt: new Date() } });
  }
  publish({ type: 'control.push', hostId, data: { ok: reply.ok, rev: p.rev, error: reply.error ?? null } });
  return { hostId, ok: reply.ok, ...(reply.error ? { error: reply.error } : {}) };
}

/** Running containers on a host, keyed by sidecar role. */
export function runningRoles(containers: ContainerLive[] | undefined): Set<string> {
  const s = new Set<string>();
  for (const c of containers ?? []) {
    const st = (c.state ?? '').toLowerCase();
    if (c.role && (st === 'running' || st === 'healthy' || st === 'up' || st === 'ready')) s.add(c.role);
  }
  return s;
}

/**
 * Min-online rule (port of enforceMinOnline): every enabled role with minOnline > 0 must run
 * on enough online hosts. Starts it on hosts that have the role but are not running it.
 */
export async function enforceMinOnline(sender: CommandSender | null = getCommandSender()): Promise<{ started: string[]; failed: string[] }> {
  const out = { started: [] as string[], failed: [] as string[] };
  if (!sender) return out;
  const live = new Map((await (await getFleetStatus()).list()).map((h) => [h.hostId, h]));
  const rows = await prisma.roleAssignment.findMany({ where: { enabled: true, minOnline: { gt: 0 } }, orderBy: { hostId: 'asc' } });
  const byMode = new Map<string, typeof rows>();
  for (const r of rows) { const k = `${r.appId}|${r.mode}`; byMode.set(k, [...(byMode.get(k) ?? []), r]); }
  for (const list of byMode.values()) {
    const want = Math.max(...list.map((r) => r.minOnline));
    const online = list.filter((r) => live.get(r.hostId)?.online);
    const role = roleKey(list[0].appId, list[0].mode);
    let running = online.filter((r) => runningRoles(live.get(r.hostId)?.containers).has(role)).length;
    for (const r of online) {
      if (running >= want) break;
      if (runningRoles(live.get(r.hostId)?.containers).has(role)) continue;
      const tag = `${r.hostId}:${r.appId}/${r.mode}`;
      try {
        const rep = await sender.send(r.hostId, 'start', { role });
        if (rep.ok) { running++; out.started.push(tag); } else out.failed.push(tag);
      } catch { out.failed.push(tag); }
    }
  }
  return out;
}
