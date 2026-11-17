import { NextResponse } from 'next/server';
import { login } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Small in-memory brake on password guessing: 10 failures per IP per 15 min.
const fails = new Map<string, { n: number; until: number }>();
const WINDOW = 15 * 60_000;

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const f = fails.get(ip);
  if (f && f.n >= 10 && f.until > Date.now()) return NextResponse.json({ error: 'Too many tries. Wait 15 minutes.' }, { status: 429 });
  let body: { username?: unknown; password?: unknown } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
  const r = await login(username, password);
  if (!r) {
    const cur = f && f.until > Date.now() ? f : { n: 0, until: Date.now() + WINDOW };
    fails.set(ip, { n: cur.n + 1, until: cur.until });
    await audit(username, 'login.failed', null, { ip });
    return NextResponse.json({ error: 'Wrong username or password' }, { status: 401 });
  }
  fails.delete(ip);
  await audit(r.user.username, 'login', null, { ip });
  const res = NextResponse.json({ ok: true, user: r.user.username });
  res.cookies.set(sessionCookie(r.token));
  return res;
}
