import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiUser } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** POST { action: 'ack' | 'close' | 'mute' | 'unmute' }. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  const { id } = await ctx.params;
  let body: { action?: unknown } = {};
  try { body = await req.json(); } catch { /* none */ }
  const a = await prisma.alert.findUnique({ where: { id } });
  if (!a) return NextResponse.json({ error: 'No such alert' }, { status: 404 });
  const now = new Date();
  const data =
    body.action === 'ack' ? (a.state === 'open' ? { state: 'ack', ackedAt: now, ackedBy: u.username } : null)
    : body.action === 'close' ? (a.state !== 'closed' ? { state: 'closed', closedAt: now } : null)
    : body.action === 'mute' ? { muted: true }
    : body.action === 'unmute' ? { muted: false }
    : undefined;
  if (data === undefined) return NextResponse.json({ error: 'action must be ack, close, mute or unmute' }, { status: 400 });
  if (data === null) return NextResponse.json({ error: `Alert is ${a.state}` }, { status: 409 });
  const r = await prisma.alert.update({ where: { id }, data });
  await audit(u.username, `alert.${body.action}`, a.key);
  return NextResponse.json(r);
}
