import { NextResponse } from 'next/server';
import { ReleaseError, importGitlabRelease } from '@/lib/releases';
import { requireApiUser } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** POST { tag, product?, channel?, rollout? }: import update-<platform>.json from a GitLab release. */
export async function POST(req: Request) {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }); }
  const s = (x: unknown) => (typeof x === 'string' && x ? x : undefined);
  try {
    const r = await importGitlabRelease({ tag: String(b.tag ?? ''), product: s(b.product), channel: s(b.channel), rollout: s(b.rollout) }, u.username);
    await audit(u.username, 'release.import.gitlab', r.tag, r);
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof ReleaseError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
