import { NextResponse } from 'next/server';
import { NetbirdError, netbirdStore } from '@/lib/netbird';
import { requireApiUser } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  return NextResponse.json(netbirdStore().view());
}

export async function PUT(req: Request) {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }); }
  try {
    const v = netbirdStore().update(body);
    await audit(u.username, 'settings.netbird.update', null, body);
    return NextResponse.json(v);
  } catch (e) {
    if (e instanceof NetbirdError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
