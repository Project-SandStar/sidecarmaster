/**
 * Task 3.2: role assignments and host provisioning, keyed by hostId.
 * Port of court-lens-mcp admin-role-assignments / admin-host-provisioning rules (per app).
 */
import { prisma } from '../db';
import { RUNTIMES } from '../apps/catalog';
import { ControlError, int, str } from './errors';
import { bumpHosts, modeView } from './registry';
import { hostOsKind } from './ports';
import { publish } from './events';

const OS_OVERRIDES = ['linux', 'mac-docker-ollama', 'windows-docker-wsl2'];

export interface RoleInput {
  enabled?: boolean; minOnline?: number; idleTimeoutMin?: number; modelOverride?: string | null; runtime?: string | null;
}

/** Create or update one role row. Refuses modes the host OS cannot run and runtimes the mode does not allow. */
export async function setRole(hostId: string, appId: string, mode: string, b: Record<string, unknown>) {
  const host = await prisma.host.findUnique({ where: { id: hostId } });
  if (!host) throw new ControlError(`No host "${hostId}"`, 404);
  const mrow = await prisma.appMode.findUnique({ where: { appId_name: { appId, name: mode } } });
  if (!mrow) throw new ControlError(`No mode ${appId}/${mode}`, 404);
  const m = modeView(mrow);
  const d: Record<string, unknown> = {};
  if (b.enabled !== undefined) d.enabled = b.enabled === true;
  if (b.minOnline !== undefined) d.minOnline = int(b.minOnline, 'minOnline', 0, 16);
  if (b.idleTimeoutMin !== undefined) d.idleTimeoutMin = int(b.idleTimeoutMin, 'idleTimeoutMin', 0, 24 * 60);
  if (b.modelOverride !== undefined) d.modelOverride = str(b.modelOverride, 'modelOverride', true);
  if (b.runtime !== undefined) {
    const rt = str(b.runtime, 'runtime', true);
    if (rt && !(RUNTIMES as readonly string[]).includes(rt)) throw new ControlError(`runtime must be one of ${RUNTIMES.join(', ')}`);
    if (rt && m.runtimes.length && !m.runtimes.includes(rt)) throw new ControlError(`${mode} does not run on ${rt} (allowed: ${m.runtimes.join(', ')})`);
    d.runtime = rt;
  }
  const os = hostOsKind(host.hostOsOverride ?? host.os);
  if (d.enabled === true && os && m.availableOn.length && !m.availableOn.includes(os)) {
    throw new ControlError(`${mode} is not available on ${os}`, 409);
  }
  const row = await prisma.roleAssignment.upsert({
    where: { hostId_appId_mode: { hostId, appId, mode } },
    create: { hostId, appId, mode, ...d },
    update: d,
  });
  // A role needs the app on the host: add the HostApp row when missing.
  await prisma.hostApp.upsert({ where: { hostId_appId: { hostId, appId } }, create: { hostId, appId }, update: {} });
  await bumpHosts({ hostId });
  publish({ type: 'role.set', appId, hostId, data: { mode, ...d } });
  return row;
}

export async function deleteRole(hostId: string, appId: string, mode: string) {
  const r = await prisma.roleAssignment.findUnique({ where: { hostId_appId_mode: { hostId, appId, mode } } });
  if (!r) throw new ControlError('No such role', 404);
  await prisma.roleAssignment.delete({ where: { id: r.id } });
  await bumpHosts({ hostId });
  publish({ type: 'role.delete', appId, hostId, data: { mode } });
}

/** Host-level fields: OS override, reconcile switch, note, name. */
export async function updateHost(hostId: string, b: Record<string, unknown>) {
  if (!(await prisma.host.findUnique({ where: { id: hostId } }))) throw new ControlError(`No host "${hostId}"`, 404);
  const d: Record<string, unknown> = {};
  if (b.hostOsOverride !== undefined) {
    const v = str(b.hostOsOverride, 'hostOsOverride', true);
    if (v && !OS_OVERRIDES.includes(v)) throw new ControlError(`hostOsOverride must be one of ${OS_OVERRIDES.join(', ')}`);
    d.hostOsOverride = v;
  }
  if (b.reconcileEnabled !== undefined) d.reconcileEnabled = b.reconcileEnabled === true;
  if (b.note !== undefined) d.note = str(b.note, 'note', true);
  if (b.name !== undefined) {
    const n = str(b.name, 'name')!;
    const other = await prisma.host.findUnique({ where: { name: n } });
    if (other && other.id !== hostId) throw new ControlError(`Host name "${n}" is taken`, 409);
    d.name = n;
  }
  const h = await prisma.host.update({ where: { id: hostId }, data: { ...d, policyRev: { increment: 1 } } });
  publish({ type: 'host.update', hostId, data: d });
  return h;
}

/** Per-app provisioning on a host (master URL / WS port override). */
export async function setHostApp(hostId: string, appId: string, b: Record<string, unknown>) {
  if (!(await prisma.host.findUnique({ where: { id: hostId } }))) throw new ControlError(`No host "${hostId}"`, 404);
  if (!(await prisma.app.findUnique({ where: { id: appId } }))) throw new ControlError(`No app "${appId}"`, 404);
  const d: Record<string, unknown> = {};
  if (b.enabled !== undefined) d.enabled = b.enabled === true;
  if (b.masterUrlOverride !== undefined) {
    const u = str(b.masterUrlOverride, 'masterUrlOverride', true);
    if (u && !/^https?:\/\/\S+$/.test(u)) throw new ControlError('masterUrlOverride must be an http(s) URL');
    d.masterUrlOverride = u;
  }
  if (b.wsPortOverride !== undefined) d.wsPortOverride = int(b.wsPortOverride, 'wsPortOverride', 1, 65535, true);
  if (b.notes !== undefined) d.notes = str(b.notes, 'notes', true);
  const row = await prisma.hostApp.upsert({ where: { hostId_appId: { hostId, appId } }, create: { hostId, appId, ...d }, update: d });
  await bumpHosts({ hostId });
  publish({ type: 'hostapp.set', appId, hostId, data: d });
  return row;
}
