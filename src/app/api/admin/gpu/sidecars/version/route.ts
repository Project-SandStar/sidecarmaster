import { NextResponse } from 'next/server';
import { latestSidecarRelease } from '@/lib/sidecar-update';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/gpu/sidecars/version — the sidecar's update check (same path as Sound Suite).
 * The newest docker-sidecar/linux/stable release from the Releases page for this caller; 404 when none.
 */
export async function GET(req: Request) {
  const r = await latestSidecarRelease(req);
  if (!r) return NextResponse.json({ error: 'No sidecar release' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json(
    { version: r.version, build: r.build, sha256: r.sha256, filename: r.fileName ?? `sidecar-${r.version}.tar.gz`, notes: r.notes },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
