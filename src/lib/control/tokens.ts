/**
 * Task 3.5: per-app API tokens. One token per app, stored as sha256; scopes fleet:read, fleet:write, commands.
 * Token format `smk_<appId>_<random>`. The plain token is shown once, at creation.
 */
import { NextResponse } from 'next/server';
import { prisma } from '../db';
import { randomToken, secretHint, sha256Hex } from '../crypto';
import { ControlError } from './errors';

export const SCOPES = ['fleet:read', 'fleet:write', 'commands'] as const;
export type Scope = (typeof SCOPES)[number];

export async function issueAppToken(appId: string, scopes: unknown): Promise<{ token: string; hint: string; scopes: Scope[] }> {
  if (!(await prisma.app.findUnique({ where: { id: appId } }))) throw new ControlError(`No app "${appId}"`, 404);
  const list = Array.isArray(scopes) ? scopes : ['fleet:read'];
  if (list.length === 0 || list.some((s) => !(SCOPES as readonly string[]).includes(s as string))) {
    throw new ControlError(`scopes: list of ${SCOPES.join(', ')}`);
  }
  const token = `smk_${appId}_${randomToken(24)}`;
  const hint = secretHint(token)!;
  await prisma.app.update({
    where: { id: appId },
    data: { apiTokenHash: sha256Hex(token), apiTokenHint: hint, apiScopes: JSON.stringify([...new Set(list)]), apiTokenAt: new Date() },
  });
  return { token, hint, scopes: list as Scope[] };
}

export async function revokeAppToken(appId: string): Promise<void> {
  if (!(await prisma.app.findUnique({ where: { id: appId } }))) throw new ControlError(`No app "${appId}"`, 404);
  await prisma.app.update({ where: { id: appId }, data: { apiTokenHash: null, apiTokenHint: null, apiScopes: '[]', apiTokenAt: null } });
}

export interface AppCaller { appId: string; scopes: Scope[] }

/** Bearer token → app, or null. */
export async function appForToken(token: string | null | undefined): Promise<AppCaller | null> {
  if (!token || !token.startsWith('smk_')) return null;
  const a = await prisma.app.findUnique({ where: { apiTokenHash: sha256Hex(token) } });
  if (!a || !a.enabled) return null;
  let scopes: Scope[] = [];
  try { scopes = JSON.parse(a.apiScopes); } catch { /* none */ }
  return { appId: a.id, scopes };
}

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  if (m) return m[1];
  // EventSource cannot send headers: allow ?token= for SSE only.
  try { return new URL(req.url).searchParams.get('token'); } catch { return null; }
}

/**
 * Caller for /api/v1: an app token with the scope (401 no/bad token, 403 wrong scope),
 * or a logged-in admin (all scopes). `appId` limits app tokens to their own app.
 */
export async function requireScope(req: Request, scope: Scope, appId?: string): Promise<AppCaller | { admin: string } | NextResponse> {
  const t = bearer(req);
  if (t) {
    const c = await appForToken(t);
    if (!c) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    if (!c.scopes.includes(scope)) return NextResponse.json({ error: `Token lacks scope ${scope}` }, { status: 403 });
    if (appId && c.appId !== appId) return NextResponse.json({ error: `Token is for app ${c.appId}` }, { status: 403 });
    return c;
  }
  const { currentUser } = await import('../session');
  const u = await currentUser();
  if (u) return { admin: u.username };
  return NextResponse.json({ error: 'Bearer token required' }, { status: 401 });
}
