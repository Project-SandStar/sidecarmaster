import { NextResponse } from 'next/server';
import { SmtpError, smtpView, updateSmtp } from '@/lib/alerts/smtp';
import { requireApiUser } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  return NextResponse.json(await smtpView());
}

export async function PUT(req: Request) {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }); }
  try {
    const v = await updateSmtp(body);
    await audit(u.username, 'settings.alerts.update', null, body);
    return NextResponse.json(v);
  } catch (e) {
    if (e instanceof SmtpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
