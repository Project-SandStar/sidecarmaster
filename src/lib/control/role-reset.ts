/** "Reset to defaults" for one host (Sound Suite resetToDefaults), keyed by hostId. Saves only; never pushes. */
import { prisma } from '../db';
import { ControlError } from './errors';
import { bumpHosts, listModeViews } from './registry';
import { publish } from './events';
import { resetPlan, resolveHostOs } from './role-grid';

export async function resetHostRoles(hostId: string, appFilter?: string | null) {
  const h = await prisma.host.findUnique({ where: { id: hostId } });
  if (!h) throw new ControlError(`No host "${hostId}"`, 404);
  const modes = (await listModeViews()).filter((m) => !appFilter || m.appId === appFilter);
  const os = resolveHostOs(h.hostOsOverride, h.os, h.hostname ?? h.name).os;
  const plan = resetPlan(modes, os);
  let enabled = 0, removed = 0;
  for (const p of plan) {
    const where = { hostId_appId_mode: { hostId, appId: p.appId, mode: p.mode } };
    if (!p.enabled) {
      const del = await prisma.roleAssignment.deleteMany({ where: { hostId, appId: p.appId, mode: p.mode } });
      removed += del.count;
      continue;
    }
    const d = { enabled: true, minOnline: p.minOnline, idleTimeoutMin: p.idleTimeoutMin, modelOverride: null, runtime: p.runtime };
    await prisma.roleAssignment.upsert({ where, create: { hostId, appId: p.appId, mode: p.mode, ...d }, update: d });
    await prisma.hostApp.upsert({ where: { hostId_appId: { hostId, appId: p.appId } }, create: { hostId, appId: p.appId }, update: {} });
    enabled++;
  }
  await bumpHosts({ hostId });
  publish({ type: 'role.reset', hostId, data: { app: appFilter ?? null, os, enabled, removed } });
  return { hostId, os, enabled, removed, plan };
}
