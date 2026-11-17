import { NextResponse } from 'next/server';
import { FeedError, latestRelease } from '@/lib/updates';

export const dynamic = 'force-dynamic';

/**
 * Public update feed (fileSystemSideCar docs/update-feed.md). 200 + JSON, or 204 when no build.
 * Optional ?host=<host id or name> also returns builds rolled out to that host only.
 */
export async function GET(req: Request, ctx: { params: Promise<{ product: string; platform: string }> }) {
  const { product, platform } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const channel = q.get('channel') || 'stable';
  try {
    const e = await latestRelease(product, platform, channel, q.get('host'));
    if (!e) return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json(e, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof FeedError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
