import { NextResponse } from 'next/server';
import { ReleaseError, deleteRelease, setRollout } from '@/lib/releases';
import { requireApiUser } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** PATCH { rollout: 'all' | 'hosts' | 'none', hostIds?: string[] }: roll out to all, to some hosts, or hold back. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  const { id } = await ctx.params;
  let b: { rollout?: unknown; hostIds?: unknown } = {};
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }); }
  const hostIds = Array.isArray(b.hostIds) ? b.hostIds.map(String) : undefined;
  try {
    const r = await setRollout(id, String(b.rollout ?? ''), hostIds, u.username);
    await audit(u.username, 'release.rollout', `${r.product}/${r.platform}/${r.channel}#${r.build}`, { rollout: r.rollout, hostIds: r.hosts.map((h) => h.hostId) });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof ReleaseError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  const { id } = await ctx.params;
  try {
    const r = await deleteRelease(id);
    await audit(u.username, 'release.delete', `${r.product}/${r.platform}/${r.channel}#${r.build}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ReleaseError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
