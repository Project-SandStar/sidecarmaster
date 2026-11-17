import { NextResponse } from 'next/server';
import { SmtpError, parseRecipients, sendMail, testEmailBody, validEmail } from '@/lib/alerts/smtp';
import { requireApiUser } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Send a test email with the saved settings. Optional body { to } overrides the recipients. */
export async function POST(req: Request) {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  let body: { to?: unknown } = {};
  try { body = await req.json(); } catch { /* no body */ }
  const to = parseRecipients(body.to);
  const bad = to.find((x) => !validEmail(x));
  if (bad) return NextResponse.json({ error: `Not a valid email address: ${bad}` }, { status: 400 });
  const m = testEmailBody(u.username);
  try {
    const r = await sendMail(m.subject, m.text, { to });
    await audit(u.username, 'alerts.test.sent', null, { to: r.to });
    return NextResponse.json({ ok: true, to: r.to });
  } catch (e) {
    if (e instanceof SmtpError) {
      await audit(u.username, 'alerts.test.failed', null, { error: e.message });
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    throw e;
  }
}
