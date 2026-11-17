/** Read-only queries for the dashboard pages. */
import { prisma } from './db';

export async function listHosts() {
  return prisma.host.findMany({ orderBy: { name: 'asc' }, include: { roles: true, apps: true, aliases: true } });
}

/** Fleet rows: DB hosts + live relay state. */
export async function fleetRows() {
  const { buildFleetView } = await import('./fleet/view');
  const { fleetStatus } = await import('./fleet/interfaces');
  return buildFleetView(await listHosts(), fleetStatus.list());
}
export async function listModes() {
  return prisma.appMode.findMany({ orderBy: [{ appId: 'asc' }, { name: 'asc' }], include: { app: true } });
}
export async function listRoles() {
  return prisma.roleAssignment.findMany({ orderBy: [{ appId: 'asc' }, { mode: 'asc' }], include: { host: true } });
}
export async function listHostApps() {
  return prisma.hostApp.findMany({ orderBy: [{ appId: 'asc' }], include: { host: true, app: true } });
}
export async function lastImport() {
  return prisma.importRun.findFirst({ where: { dryRun: false }, orderBy: { at: 'desc' } });
}

export interface StatusSnap { status?: string | null; mode?: string | null; containers?: unknown }
export function parseSnap(s: string | null): StatusSnap | null {
  if (!s) return null;
  try { return JSON.parse(s) as StatusSnap; } catch { return null; }
}
export function containerCount(c: unknown): number {
  if (Array.isArray(c)) return c.length;
  if (c && typeof c === 'object') return Object.keys(c).length;
  return 0;
}
export function ago(d: Date | null): string {
  if (!d) return '—';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
