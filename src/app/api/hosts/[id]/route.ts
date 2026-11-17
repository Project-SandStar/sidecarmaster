import { NextResponse } from 'next/server';
import { asAdmin } from '@/lib/control/admin-route';
import { readJson } from '@/lib/control/errors';
import { updateHost } from '@/lib/control/roles';
import { buildHostPolicy } from '@/lib/control/policy';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ id: string }> };

/** Desired policy (what the next config push sends). Tokens are cut to a hint. */
export async function GET(_req: Request, ctx: P) {
  return asAdmin(async () => {
    const p = await buildHostPolicy((await ctx.params).id);
    if (!p) return NextResponse.json({ error: 'No such host' }, { status: 404 });
    const masters = p.config.masters.map((m) => ({ ...m, token: m.token ? `…${m.token.slice(-4)}` : undefined }));
    return NextResponse.json({ ...p, config: { ...p.config, masters } });
  });
}

export async function PUT(req: Request, ctx: P) {
  return asAdmin(async (u) => {
    const { id } = await ctx.params;
    const b = await readJson(req);
    const h = await updateHost(id, b);
    await audit(u.username, 'host.update', h.name, b);
    return NextResponse.json({ id: h.id, name: h.name, hostOsOverride: h.hostOsOverride, reconcileEnabled: h.reconcileEnabled, note: h.note, policyRev: h.policyRev });
  });
}
