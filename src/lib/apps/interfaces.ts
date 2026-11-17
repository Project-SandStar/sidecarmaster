/**
 * App registry view used by the dashboard and alerts (Phase 5).
 * Phase 3 owns the real registry and can register it with setAppRegistry(); until then
 * dbAppRegistry() reads the App / AppMode tables.
 */
import { prisma } from '../db';

export interface AppInfo {
  id: string; displayName: string; masterUrl: string | null; wsUrl: string | null;
  protocol: string; enabled: boolean; modes: string[];
}

export interface AppRegistry {
  list(): Promise<AppInfo[]>;
  /** URL that answers 2xx when the app is healthy, or null when the app has none. */
  healthUrl(appId: string): Promise<string | null>;
}

export class InMemoryAppRegistry implements AppRegistry {
  constructor(private apps: AppInfo[], private health: Record<string, string | null> = {}) {}
  async list() { return this.apps; }
  async healthUrl(id: string) { return this.health[id] ?? null; }
}

/** Apps with a sidecar master are probed at <masterUrl>/api/health. */
export function defaultHealthUrl(a: Pick<AppInfo, 'masterUrl' | 'protocol' | 'enabled'>): string | null {
  if (!a.enabled || !a.masterUrl || a.protocol === 'none') return null;
  return `${a.masterUrl.replace(/\/+$/, '')}/api/health`;
}

export function dbAppRegistry(): AppRegistry {
  const load = async () => (await prisma.app.findMany({ orderBy: { id: 'asc' }, include: { modes: true } }))
    .map((a) => ({ id: a.id, displayName: a.displayName, masterUrl: a.masterUrl, wsUrl: a.wsUrl, protocol: a.protocol, enabled: a.enabled, modes: a.modes.map((m) => m.name) }));
  return {
    list: load,
    async healthUrl(id) { const a = (await load()).find((x) => x.id === id); return a ? defaultHealthUrl(a) : null; },
  };
}

const g = globalThis as unknown as { __smApps?: AppRegistry };
export function setAppRegistry(r: AppRegistry | undefined) { g.__smApps = r; }
export function getAppRegistry(): AppRegistry { return g.__smApps ?? dbAppRegistry(); }

/** Map a container role / mode name to its app: the mode catalog, then the name prefix. */
export function appForMode(mode: string | null | undefined, apps: AppInfo[]): string | null {
  if (!mode) return null;
  const hit = apps.find((a) => a.modes.includes(mode));
  if (hit) return hit.id;
  if (mode.startsWith('ss-')) return 'soundsuite';
  const p = apps.find((a) => mode.startsWith(`${a.id}-`));
  return p?.id ?? null;
}
