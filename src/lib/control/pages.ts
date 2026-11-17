/** Server-side data for the control pages (role assignments, host provisioning). */
import { prisma } from '../db';
import { getFleetStatus } from '../fleet/interfaces';
import { listModeViews, modelFor } from './registry';
import { effectiveRuntime, portForRuntime, reportedPortFor, roleKey } from './ports';
import { gpuSummary, gridCells, gridColumns, loadedModels, modeAvailableOn, portNote, resolveHostOs, unavailableReason } from './role-grid';
import { runningRoles } from './policy';
import type { RoleGridRow, RoleHostCard } from '@/components/control/RoleGrid';
import type { HostProvView } from '@/components/control/HostProvForm';

/** Role assignment grid: one card per host, one row per mode, one radio cell per runtime (Sound Suite layout). */
export async function roleGridData(appFilter?: string | null): Promise<RoleHostCard[]> {
  const modes = (await listModeViews()).filter((m) => !appFilter || m.appId === appFilter);
  const hosts = await prisma.host.findMany({ orderBy: { name: 'asc' }, include: { roles: true } });
  const fleet = await getFleetStatus();
  const out: RoleHostCard[] = [];
  for (const h of hosts) {
    const live = await fleet.get(h.id);
    // The OS the sidecar reports wins; the manual override is the fallback (shown as a marker).
    const osInfo = resolveHostOs(h.hostOsOverride, h.os, live?.hostname ?? h.hostname ?? h.name);
    const os = osInfo.os;
    const running = runningRoles(live?.containers);
    const rows: RoleGridRow[] = modes.map((m) => {
      const r = h.roles.find((x) => x.appId === m.appId && x.mode === m.name);
      const rt = effectiveRuntime(m, r?.runtime, os);
      const reported = reportedPortFor(live?.containers, m.appId, m.name, rt) ?? null;
      const note = portNote(rt, reported !== null, h.name);
      const onOs = modeAvailableOn(m, os);
      return {
        appId: m.appId, mode: m.name, label: m.label, description: m.description,
        enabled: !!r?.enabled, runtime: rt, cells: gridCells(m, os),
        unavailable: onOs ? null : unavailableReason(m.name, os),
        port: reported ?? portForRuntime(m.name, rt, { [m.name]: m.port }) ?? null, portShared: note.shared, portTitle: note.title,
        minOnline: r?.minOnline ?? 0, idleTimeoutMin: r?.idleTimeoutMin ?? 5, modelOverride: r?.modelOverride ?? null,
        defaultModel: modelFor(m, os), running: running.has(roleKey(m.appId, m.name)),
      };
    });
    out.push({
      hostId: h.id, name: h.name, agentUrl: h.agentUrl, online: !!live?.online,
      lastHeartbeatAt: (live?.lastHeartbeatAt ?? h.lastHeartbeatAt)?.toISOString() ?? null,
      os: osInfo, gpu: gpuSummary(live?.gpus), loaded: loadedModels(live?.containers),
      columns: gridColumns(modes, os), rows,
    });
  }
  return out;
}

export async function hostProvData(): Promise<HostProvView[]> {
  const apps = await prisma.app.findMany({ orderBy: { id: 'asc' } });
  const hosts = await prisma.host.findMany({ orderBy: { name: 'asc' }, include: { apps: true } });
  return hosts.map((h) => ({
    hostId: h.id, name: h.name, os: h.os, hostOsOverride: h.hostOsOverride, reconcileEnabled: h.reconcileEnabled, note: h.note,
    policyRev: h.policyRev, pushedPolicyRev: h.pushedPolicyRev, lastConfigPushAt: h.lastConfigPushAt?.toISOString() ?? null,
    apps: apps.map((a) => {
      const ha = h.apps.find((x) => x.appId === a.id);
      return {
        appId: a.id, displayName: a.displayName, protocol: a.protocol, enabled: ha?.enabled ?? false,
        masterUrlOverride: ha?.masterUrlOverride ?? null, wsPortOverride: ha?.wsPortOverride ?? null, defaultMaster: a.masterUrl,
      };
    }),
  }));
}
