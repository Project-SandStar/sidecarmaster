/**
 * One real box = one Host row. A sidecar can show up under several URLs (LAN IP, NetBird IP,
 * DHCP moves). We match in this order: v2 hostId, alias URL, Host.agentUrl, reported hostname.
 * Every URL seen is kept in HostAlias.
 */
import type { PrismaClient } from '@prisma/client';
import { normalizeUrl } from '../protocol';

/** Hostname key: lower case, trimmed, no ".local". Null for "unknown"/empty. */
export function hostKey(h: string | null | undefined): string | null {
  if (!h) return null;
  const k = h.trim().toLowerCase().replace(/\.local$/, '');
  return k && k !== 'unknown' ? k : null;
}

export interface SeenSidecar {
  agentUrl: string;
  hostname?: string | null;
  /** v2 sidecars send the id they got from join. */
  hostId?: string | null;
  source: 'relay' | 'soundsuite-import';
}

type Db = Pick<PrismaClient, 'host' | 'hostAlias'>;

/** Find the host for a sidecar URL without writing anything. */
export async function findHost(db: Db, s: Omit<SeenSidecar, 'source'>) {
  const url = normalizeUrl(s.agentUrl);
  if (s.hostId) {
    const h = await db.host.findUnique({ where: { id: s.hostId } });
    if (h) return h;
  }
  const alias = await db.hostAlias.findUnique({ where: { url }, include: { host: true } });
  if (alias) return alias.host;
  const byUrl = await db.host.findUnique({ where: { agentUrl: url } });
  if (byUrl) return byUrl;
  const key = hostKey(s.hostname);
  if (key) {
    const list = await db.host.findMany({ where: { hostname: key }, orderBy: { createdAt: 'asc' }, take: 1 });
    if (list[0]) return list[0];
  }
  return null;
}

async function uniqueName(db: Db, base: string): Promise<string> {
  let n = base; let i = 2;
  while (await db.host.findUnique({ where: { name: n } })) n = `${base}-${i++}`;
  return n;
}

/**
 * Link a seen sidecar URL to a host (create one if new). Makes `url` the host's current agentUrl
 * and records it as an alias. Returns the host id.
 */
export async function linkSidecar(db: Db, s: SeenSidecar, now = new Date()): Promise<string> {
  const url = normalizeUrl(s.agentUrl);
  const key = hostKey(s.hostname);
  let host = await findHost(db, s);
  if (!host) {
    let base = key ?? url;
    try { base = key ?? new URL(url).hostname; } catch { /* keep url */ }
    host = await db.host.create({ data: { name: await uniqueName(db, base), agentUrl: url, hostname: key, source: s.source } });
  } else if (host.agentUrl !== url || (key && host.hostname !== key)) {
    // Another host row may hold this URL as agentUrl (old import). Free it first; the merge step folds that row in.
    const other = await db.host.findUnique({ where: { agentUrl: url } });
    if (other && other.id !== host.id) await db.host.update({ where: { id: other.id }, data: { agentUrl: null } });
    host = await db.host.update({ where: { id: host.id }, data: { agentUrl: url, hostname: key ?? host.hostname } });
  }
  await db.hostAlias.upsert({
    where: { url },
    create: { url, hostId: host.id, source: s.source, firstSeen: now, lastSeen: now },
    update: { hostId: host.id, lastSeen: now },
  });
  return host.id;
}
