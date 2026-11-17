/**
 * Self-update endpoints for the Docker sidecar, fed from the Releases page.
 *
 * The sidecar (court-lens-mcp sideCar/src/lib/self-update.ts) asks its master:
 *   GET /api/admin/gpu/sidecars/version   → { version, ... }; it updates when version differs
 *   GET /api/admin/gpu/sidecars/download  → the tarball, with X-Sidecar-Version and
 *                                           X-Sidecar-SHA256 (it checks the hash)
 * Both serve the newest docker-sidecar / linux / stable release this caller may get.
 *
 * The sidecar sends no host name, so a per-host rollout ('hosts') matches the
 * caller by ?host=<id or name>, else by its IP against the known host addresses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from './db';
import { releasesDir } from './releases';

export const SIDECAR_PRODUCT = 'docker-sidecar';
export const SIDECAR_PLATFORM = 'linux';

export function callerIp(req: Request): string | null {
  const raw = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip')?.trim() || '';
  const ip = raw.replace(/^::ffff:/, '');
  return ip || null;
}

const urlHost = (u: string | null): string | null => {
  if (!u) return null;
  try { return new URL(u).hostname; } catch { return null; }
};

/** Host id of the caller, or null when it cannot be told. */
export async function callerHostId(req: Request): Promise<string | null> {
  const q = new URL(req.url).searchParams.get('host');
  const hosts = await prisma.host.findMany({
    select: { id: true, name: true, hostname: true, lastSeenFromIp: true, netbirdIp: true, peerAddress: true, agentUrl: true },
  });
  if (q) {
    const l = q.toLowerCase();
    return hosts.find((h) => h.id === q || h.name.toLowerCase() === l || h.hostname === l)?.id ?? null;
  }
  const ip = callerIp(req);
  if (!ip) return null;
  const match = hosts.filter((h) =>
    [h.lastSeenFromIp, h.netbirdIp, urlHost(h.peerAddress) ?? h.peerAddress, urlHost(h.agentUrl)].includes(ip));
  // Several hosts behind one address (NAT): do not guess.
  return match.length === 1 ? match[0].id : null;
}

export async function latestSidecarRelease(req: Request) {
  const hostId = await callerHostId(req);
  return prisma.release.findFirst({
    where: {
      product: SIDECAR_PRODUCT, platform: SIDECAR_PLATFORM, channel: 'stable',
      OR: [{ rollout: 'all' }, ...(hostId ? [{ rollout: 'hosts', hosts: { some: { hostId } } }] : [])],
    },
    orderBy: { build: 'desc' },
  });
}

export type Fetcher = (url: string) => Promise<Response>;

/** The release bytes: the uploaded file, or the URL download. Null when not available. */
export async function releaseBytes(
  r: { filePath: string | null; url: string }, fetcher: Fetcher = (u) => fetch(u),
): Promise<Buffer | null> {
  if (r.filePath) {
    const p = path.join(releasesDir(), r.filePath);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  }
  const res = await fetcher(r.url);
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}
