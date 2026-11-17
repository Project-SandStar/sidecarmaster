import { NextResponse } from 'next/server';
import { readRules, updateRules } from '@/lib/alerts/rules';
import { requireApiUser } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  return NextResponse.json(await readRules());
}

export async function PUT(req: Request) {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  let b: unknown;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }); }
  try {
    const r = await updateRules(b);
    await audit(u.username, 'settings.alerts.rules', null, r);
    return NextResponse.json(r);
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
