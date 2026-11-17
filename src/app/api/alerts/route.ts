import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** GET /api/alerts?state=open|ack|closed|active (default active = open + ack). */
export async function GET(req: Request) {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  const s = new URL(req.url).searchParams.get('state') ?? 'active';
  const where = s === 'active' ? { state: { in: ['open', 'ack'] } } : { state: s };
  return NextResponse.json(await prisma.alert.findMany({ where, orderBy: { openedAt: 'desc' }, take: 500 }));
}
