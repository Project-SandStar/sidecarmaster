import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_TTL_MS, userForToken, type SessionUser } from './auth';

export async function currentUser(): Promise<SessionUser | null> {
  const c = await cookies();
  return userForToken(c.get(SESSION_COOKIE)?.value);
}

/** For pages: redirect to /login when there is no valid session. */
export async function requirePageUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect('/login');
  return u;
}

/** For API routes: a user, or a 401 response to return. */
export async function requireApiUser(): Promise<SessionUser | NextResponse> {
  const u = await currentUser();
  return u ?? NextResponse.json({ error: 'Login required' }, { status: 401 });
}

export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.SM_SECURE_COOKIES === '1',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}
