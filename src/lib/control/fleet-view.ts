/**
 * Read models for the public API (task 3.5) and the sidecar mode catalog (task 3.7).
 * The fleet view shape is what Sound Suite `fleet.source = follow` reads.
 */
import { prisma } from '../db';
import { getFleetStatus, type ContainerLive, type GpuLive, type HostLive } from '../fleet/interfaces';
import { listModeViews, modelFor, type ModeView } from './registry';
import { defaultRuntimeForRow, hostOsKind, portForRuntime, roleKey } from './ports';
import { runningRoles } from './policy';

export interface ContainerView { name: string; state: string; role: string | null; image: string | null; port: number | null; model: string | null }

export interface AppFleetView {
  appId: string; generatedAt: string;
  modes: ModeView[];
  hosts: {
    hostId: string; name: string;
    /** Hostname as the sidecar reports it. */
    hostname: string | null;
    agentUrl: string | null;
    /** Every URL this host was seen under (agentUrl first). Apps that key hosts by URL match on these. */
    aliases: string[];
    netbirdIp: string | null; os: string | null;
    online: boolean; lastHeartbeatAt: string | null;
    sidecarVersion: string | null; activeRequests: number | null;
    gpus: GpuLive[];
    /** Containers of this app on the host (live heartbeat; empty when offline). */
    containers: ContainerView[];
    masterUrl: string | null; wsPortOverride: number | null;
    roles: { mode: string; role: string; enabled: boolean; minOnline: number; idleTimeoutMin: number; model: string | null; modelOverride: string | null; runtime: string; port: number | null; running: boolean }[];
  }[];
}

/** agentUrl plus every alias, no duplicates, no trailing slash. */
export function hostAliasUrls(h: { agentUrl: string | null; aliases?: { url: string }[] }): string[] {
  const out: string[] = [];
  for (const u of [h.agentUrl, ...(h.aliases ?? []).map((a) => a.url)]) {
    const n = (u ?? '').trim().replace(/\/+$/, '');
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

function containersFor(live: HostLive | null | undefined, appId: string): ContainerView[] {
  const prefix = appId === 'soundsuite' ? 'ss-' : `${appId}-`;
  return (live?.containers ?? [])
    .filter((c: ContainerLive) => c.appId === appId || (!c.appId && (c.name.startsWith(prefix) || (c.role ?? '').startsWith(prefix))))
    .map((c) => ({ name: c.name, state: c.state, role: c.role ?? null, image: c.image ?? null, port: c.port ?? null, model: c.model ?? null }));
}

export async function appFleetView(appId: string): Promise<AppFleetView | null> {
  const app = await prisma.app.findUnique({ where: { id: appId } });
  if (!app) return null;
  const modes = await listModeViews(appId);
  const byName = new Map(modes.map((m) => [m.name, m]));
  const fleet = await getFleetStatus();
  const hosts = await prisma.host.findMany({
    where: { OR: [{ apps: { some: { appId } } }, { roles: { some: { appId } } }] },
    include: { apps: { where: { appId } }, roles: { where: { appId }, orderBy: { mode: 'asc' } }, aliases: true },
    orderBy: { name: 'asc' },
  });
  const out: AppFleetView['hosts'] = [];
  for (const h of hosts) {
    const live = await fleet.get(h.id);
    const running = runningRoles(live?.containers);
    const os = hostOsKind(h.hostOsOverride ?? h.os);
    const ha = h.apps[0];
    out.push({
      hostId: h.id, name: h.name, hostname: live?.hostname ?? h.hostname ?? null, agentUrl: h.agentUrl, aliases: hostAliasUrls(h),
      netbirdIp: h.netbirdIp, os: h.hostOsOverride ?? h.os,
      online: live?.online ?? false, lastHeartbeatAt: (live?.lastHeartbeatAt ?? h.lastHeartbeatAt)?.toISOString() ?? null,
      sidecarVersion: live?.sidecarVersion ?? h.sidecarVersion ?? null, activeRequests: live?.activeRequests ?? null,
      gpus: live?.gpus ?? [], containers: containersFor(live, appId),
      masterUrl: ha?.masterUrlOverride ?? app.masterUrl, wsPortOverride: ha?.wsPortOverride ?? null,
      roles: h.roles.map((r) => {
        const m = byName.get(r.mode);
        const runtime = r.runtime ?? (m ? defaultRuntimeForRow(m, os) : 'docker-ollama');
        const role = roleKey(appId, r.mode);
        return {
          mode: r.mode, role, enabled: r.enabled, minOnline: r.minOnline, idleTimeoutMin: r.idleTimeoutMin,
          model: r.modelOverride ?? (m ? modelFor(m, os) : null), modelOverride: r.modelOverride, runtime,
          port: portForRuntime(r.mode, runtime, { [r.mode]: m?.port }) ?? null, running: running.has(role),
        };
      }),
    });
  }
  return { appId, generatedAt: new Date().toISOString(), modes, hosts: out };
}

export async function hostsView() {
  const fleet = await getFleetStatus();
  const hosts = await prisma.host.findMany({ orderBy: { name: 'asc' }, include: { apps: true, roles: true, aliases: true } });
  return Promise.all(hosts.map(async (h) => {
    const live = await fleet.get(h.id);
    return {
      hostId: h.id, name: h.name, hostname: live?.hostname ?? h.hostname ?? null, agentUrl: h.agentUrl, aliases: hostAliasUrls(h),
      netbirdIp: h.netbirdIp, os: h.hostOsOverride ?? h.os,
      online: live?.online ?? false, lastHeartbeatAt: (live?.lastHeartbeatAt ?? h.lastHeartbeatAt)?.toISOString() ?? null,
      sidecarVersion: live?.sidecarVersion ?? h.sidecarVersion, activeRequests: live?.activeRequests ?? null, gpus: live?.gpus ?? [],
      apps: h.apps.filter((a) => a.enabled).map((a) => a.appId),
      roles: h.roles.filter((r) => r.enabled).map((r) => ({ appId: r.appId, mode: r.mode })),
      policyRev: h.policyRev, pushedPolicyRev: h.pushedPolicyRev,
    };
  }));
}

/**
 * Task 3.7: mode catalog for sidecars, in the sidecar's ContainerDef shape, keyed by role.
 * Per OS when `os` is given (models and availability resolved); else every mode with its OS list.
 */
export async function modeCatalog(osRaw?: string | null) {
  const os = hostOsKind(osRaw);
  const modes = (await listModeViews()).filter((m) => !os || !m.availableOn.length || m.availableOn.includes(os));
  const entries: Record<string, Record<string, unknown>> = {};
  for (const m of modes) {
    const runtime = defaultRuntimeForRow(m, os);
    entries[roleKey(m.appId, m.name)] = {
      appId: m.appId, mode: m.name, label: m.label, image: runtime === 'host' ? 'host-ollama' : m.image, model: modelFor(m, os),
      port: portForRuntime(m.name, runtime, { [m.name]: m.port }) ?? m.port, vram: m.vramMb ?? 0, type: m.kind,
      modes: m.kind === 'vllm' ? ['searching'] : ['indexing', 'searching'],
      containerName: m.appId === 'soundsuite' ? `ss-${roleKey(m.appId, m.name)}` : m.name,
      runtime, runtimes: m.runtimes, availableOn: m.availableOn, requiresGpu: m.requiresGpu,
      ...(Object.keys(m.env).length ? { env: m.env } : {}),
    };
  }
  return { version: 1, os, generatedAt: new Date().toISOString(), registry: entries };
}
