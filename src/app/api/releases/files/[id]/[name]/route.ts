import fs from 'node:fs';
import { NextResponse } from 'next/server';
import { releaseFile } from '@/lib/releases';

export const dynamic = 'force-dynamic';

/** Public download of an uploaded build (sidecars check the SHA-256 from the feed). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await ctx.params;
  const p = releaseFile(id, decodeURIComponent(name));
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const size = fs.statSync(p).size;
  const body = fs.readFileSync(p);
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/octet-stream', 'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${decodeURIComponent(name)}"`, 'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
