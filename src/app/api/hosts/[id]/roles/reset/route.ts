import { NextResponse } from 'next/server';
import { asAdmin } from '@/lib/control/admin-route';
import { resetHostRoles } from '@/lib/control/role-reset';
import { reconcileOff } from '@/lib/control/reconcile-switch';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ id: string }> };

/**
 * Reset one host's roles to the per-OS defaults (?app= limits it to one app). Saves only:
 * the reconcile loop pushes later when reconcile is on; nothing is pushed here.
 */
export async function POST(req: Request, ctx: P) {
  return asAdmin(async (u) => {
    const { id } = await ctx.params;
    const app = new URL(req.url).searchParams.get('app');
    const r = await resetHostRoles(id, app);
    await audit(u.username, 'role.reset', id, { app, os: r.os, enabled: r.enabled, removed: r.removed });
    return NextResponse.json({ hostId: id, os: r.os, enabled: r.enabled, removed: r.removed, pushed: false, reconcileOff: await reconcileOff() });
  });
}
