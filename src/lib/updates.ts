/**
 * Update feed (fileSystemSideCar docs/update-feed.md):
 *   GET /api/updates/<product>/<platform>?channel=stable[&host=<host id or name>]
 *   → { version, build, url, sha256, notes?, minOS? } for the newest build, 204 when none.
 * Rollout: Release.rollout 'all' (everyone), 'hosts' (only hosts in ReleaseHost), 'none' (held back).
 */
import { prisma } from './db';

export const PRODUCT_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const PLATFORM_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const CHANNEL_RE = /^[a-z0-9-]{1,32}$/;
export const PRODUCTS = ['docker-sidecar', 'filesystem-sidecar'] as const;
export const PLATFORMS = ['macos', 'windows', 'linux'] as const;
export const CHANNELS = ['stable', 'beta'] as const;
export const ROLLOUTS = ['all', 'hosts', 'none'] as const;

export interface FeedEntry {
  version: string; build: number; url: string; sha256: string; notes?: string; minOS?: string;
}

export class FeedError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Host id for ?host= (id, or name case-insensitive). */
async function resolveHost(h: string | null | undefined): Promise<string | null> {
  if (!h) return null;
  const byId = await prisma.host.findUnique({ where: { id: h }, select: { id: true } });
  if (byId) return byId.id;
  const all = await prisma.host.findMany({ select: { id: true, name: true } });
  return all.find((x) => x.name.toLowerCase() === h.toLowerCase())?.id ?? null;
}

export async function latestRelease(product: string, platform: string, channel = 'stable', host?: string | null): Promise<FeedEntry | null> {
  if (!PRODUCT_RE.test(product)) throw new FeedError('Bad product name');
  if (!PLATFORM_RE.test(platform)) throw new FeedError('Bad platform name');
  if (!CHANNEL_RE.test(channel)) throw new FeedError('Bad channel name');
  const hostId = await resolveHost(host);
  const r = await prisma.release.findFirst({
    where: {
      product, platform, channel,
      OR: [{ rollout: 'all' }, ...(hostId ? [{ rollout: 'hosts', hosts: { some: { hostId } } }] : [])],
    },
    orderBy: { build: 'desc' },
  });
  if (!r) return null;
  const e: FeedEntry = { version: r.version, build: r.build, url: r.url, sha256: r.sha256 };
  if (r.notes) e.notes = r.notes;
  if (r.minOS) e.minOS = r.minOS;
  return e;
}
