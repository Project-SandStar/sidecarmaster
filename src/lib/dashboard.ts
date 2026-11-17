/** Data for the Phase 5 pages: hosts × apps grid, host page, app page. */
import { prisma } from './db';
import { getFleetStatus, type HostLive } from './fleet/interfaces';
import { appForMode, getAppRegistry, type AppInfo } from './apps/interfaces';

export type CellState = 'running' | 'starting' | 'created' | 'stopped' | 'error' | 'unknown' | 'down';
export interface Cell { state: CellState; roles: string[]; activeRequests: number }

export function containerState(s: string): CellState {
  const x = s.toLowerCase();
  if (x === 'running' || x === 'healthy' || x === 'up') return 'running';
  if (x === 'created') return 'created';
  if (x === 'starting' || x === 'restarting' || x === 'pulling') return 'starting';
  if (x === 'exited' || x === 'stopped' || x === 'idle' || x === 'paused') return 'stopped';
  if (x === 'error' || x === 'dead' || x === 'unhealthy' || x === 'failed') return 'error';
  return 'unknown';
}

const RANK: Record<CellState, number> = { error: 6, down: 5, starting: 4, running: 3, created: 2, stopped: 1, unknown: 0 };

/** One cell per (host, app): the worst container state, the roles, the active requests. */
export function buildGrid(hosts: HostLive[], apps: AppInfo[], assigned: { hostId: string; appId: string; mode: string }[]) {
  const grid: Record<string, Record<string, Cell>> = {};
  for (const h of hosts) {
    const row: Record<string, Cell> = {};
    const cell = (appId: string) => (row[appId] ??= { state: 'unknown', roles: [], activeRequests: 0 });
    for (const a of assigned.filter((x) => x.hostId === h.hostId)) {
      const c = cell(a.appId);
      if (!c.roles.includes(a.mode)) c.roles.push(a.mode);
    }
    for (const c of h.containers ?? []) {
      const appId = c.appId ?? appForMode(c.role ?? c.name, apps);
      if (!appId) continue;
      const x = cell(appId);
      const st = containerState(c.state);
      if (RANK[st] > RANK[x.state]) x.state = st;
      const role = c.role ?? c.name;
      if (role && !x.roles.includes(role)) x.roles.push(role);
    }
    for (const r of h.roles ?? []) {
      const appId = r.appId ?? appForMode(r.mode, apps);
      if (appId) cell(appId).activeRequests += r.activeRequests;
    }
    if (!h.online) for (const c of Object.values(row)) c.state = 'down';
    grid[h.hostId] = row;
  }
  return grid;
}

export async function loadOverview() {
  const fleet = await getFleetStatus();
  const [hosts, apps, assigned, alerts] = await Promise.all([
    fleet.list(), getAppRegistry().list(),
    prisma.roleAssignment.findMany({ where: { enabled: true }, select: { hostId: true, appId: true, mode: true } }),
    prisma.alert.findMany({ where: { state: { in: ['open', 'ack'] } }, orderBy: { openedAt: 'desc' } }),
  ]);
  return { hosts, apps, grid: buildGrid(hosts, apps, assigned), alerts };
}

export const STATE_CLASS: Record<CellState, string> = {
  running: 'bg-green-100 text-green-800', starting: 'bg-blue-100 text-blue-800', created: 'bg-slate-200 text-slate-800', stopped: 'bg-gray-100 text-gray-600',
  error: 'bg-red-100 text-red-800', down: 'bg-red-200 text-red-900', unknown: 'bg-gray-50 text-gray-400',
};

/** Alerts for one app in the last 24 h (newest first). */
export async function appErrors24h(appId: string, now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3600_000);
  return prisma.alert.findMany({ where: { appId, openedAt: { gte: since } }, orderBy: { openedAt: 'desc' } });
}
