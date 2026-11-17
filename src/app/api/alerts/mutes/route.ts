import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiUser } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
const RULES = ['host-down', 'app-down', 'update-failed', 'disk-low', 'gpu-high'];

export async function GET() {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  return NextResponse.json(await prisma.alertMute.findMany({ where: { until: { gt: new Date() } }, orderBy: { until: 'asc' } }));
}

/** POST { rule?, hostId?, appId?, minutes, reason? }: mute matching alerts (no email) until then. */
export async function POST(req: Request) {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }); }
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
  const rule = str(b.rule), hostId = str(b.hostId), appId = str(b.appId);
  if (rule && !RULES.includes(rule)) return NextResponse.json({ error: `rule must be one of ${RULES.join(', ')}` }, { status: 400 });
  if (!rule && !hostId && !appId) return NextResponse.json({ error: 'Give a rule, a host or an app to mute' }, { status: 400 });
  const minutes = Number(b.minutes);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60 * 24 * 30) return NextResponse.json({ error: 'minutes must be 1-43200' }, { status: 400 });
  const m = await prisma.alertMute.create({ data: { rule, hostId, appId, until: new Date(Date.now() + minutes * 60_000), reason: str(b.reason), createdBy: u.username } });
  await audit(u.username, 'alert.mute.add', m.id, { rule, hostId, appId, minutes });
  return NextResponse.json(m);
}

/** DELETE ?id=<mute id>. */
export async function DELETE(req: Request) {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  const r = await prisma.alertMute.deleteMany({ where: { id } });
  if (!r.count) return NextResponse.json({ error: 'No such mute' }, { status: 404 });
  await audit(u.username, 'alert.mute.remove', id);
  return NextResponse.json({ ok: true });
}
