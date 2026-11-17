import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { latestSidecarRelease, releaseBytes } from '@/lib/sidecar-update';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/gpu/sidecars/download — the tarball for the release /version reported,
 * with X-Sidecar-Version and X-Sidecar-SHA256 (the sidecar refuses a hash mismatch).
 * A URL release is fetched here and checked before it is served.
 */
export async function GET(req: Request) {
  const r = await latestSidecarRelease(req);
  if (!r) return NextResponse.json({ error: 'No sidecar release' }, { status: 404 });
  const body = await releaseBytes(r).catch(() => null);
  if (!body) return NextResponse.json({ error: 'Release file not available' }, { status: 502 });
  if (crypto.createHash('sha256').update(body).digest('hex') !== r.sha256) {
    return NextResponse.json({ error: 'Release file does not match its SHA-256' }, { status: 502 });
  }
  const name = r.fileName ?? `sidecar-${r.version}.tar.gz`;
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': String(body.length),
      'X-Sidecar-Version': r.version,
      'X-Sidecar-SHA256': r.sha256,
      'Cache-Control': 'no-store',
    },
  });
}
