import { NextResponse } from 'next/server';
import { asAdmin } from '@/lib/control/admin-route';
import { readJson } from '@/lib/control/errors';
import { issueAppToken, revokeAppToken } from '@/lib/control/tokens';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ id: string }> };

/** Issue (or replace) the app's API token. The plain token is in this reply only. */
export async function POST(req: Request, ctx: P) {
  return asAdmin(async (u) => {
    const { id } = await ctx.params;
    const b = await readJson(req).catch(() => ({} as Record<string, unknown>));
    const t = await issueAppToken(id, b.scopes);
    await audit(u.username, 'app.token.issue', id, { scopes: t.scopes, hint: t.hint });
    return NextResponse.json(t, { status: 201 });
  });
}

export async function DELETE(_req: Request, ctx: P) {
  return asAdmin(async (u) => {
    const { id } = await ctx.params;
    await revokeAppToken(id);
    await audit(u.username, 'app.token.revoke', id);
    return NextResponse.json({ ok: true });
  });
}
