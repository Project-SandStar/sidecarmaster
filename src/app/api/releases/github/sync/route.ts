import { NextResponse } from 'next/server';
import { syncGithubRelease } from '@/lib/github-releases';
import { ReleaseError } from '@/lib/releases';
import { requireApiUser } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** POST { tag? }: import the newest GitHub release now (or one tag). */
export async function POST(req: Request) {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  const b = (await req.json().catch(() => ({}))) as { tag?: unknown };
  try {
    const r = await syncGithubRelease({ tag: typeof b.tag === 'string' && b.tag ? b.tag : undefined }, u.username);
    await audit(u.username, 'release.import.github', r.tag, r);
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof ReleaseError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
