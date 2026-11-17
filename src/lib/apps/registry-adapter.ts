/**
 * Phase 5 AppRegistry over the Phase 3 app registry. An app's own probeUrl wins over
 * the default <masterUrl>/api/health.
 */
import { prisma } from '../db';
import { defaultHealthUrl, type AppInfo, type AppRegistry } from './interfaces';

async function load() {
  return prisma.app.findMany({ orderBy: { id: 'asc' }, include: { modes: true } });
}

export function controlAppRegistry(): AppRegistry {
  return {
    async list(): Promise<AppInfo[]> {
      return (await load()).map((a) => ({
        id: a.id, displayName: a.displayName, masterUrl: a.masterUrl, wsUrl: a.wsUrl,
        protocol: a.protocol, enabled: a.enabled, modes: a.modes.map((m) => m.name),
      }));
    },
    async healthUrl(id) {
      const a = await prisma.app.findUnique({ where: { id } });
      if (!a) return null;
      if (a.enabled && a.probeUrl) return a.probeUrl;
      return defaultHealthUrl(a);
    },
  };
}
