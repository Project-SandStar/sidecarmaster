import { NextResponse } from 'next/server';
import { HOST_ACTIONS, getFleetControl, type HostAction } from '@/lib/fleet/interfaces';
import { prisma } from '@/lib/db';
import { requireApiUser } from '@/lib/session';
import { audit } from '@/lib/audit';
import { reconcileOff } from '@/lib/control/reconcile-switch';

export const dynamic = 'force-dynamic';

/** POST { action }: restart-sidecar | update | provision | freeze | unfreeze. Needs Phase 2/3 FleetControl. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  const { id } = await ctx.params;
  let b: { action?: unknown; args?: unknown } = {};
  try { b = await req.json(); } catch { /* none */ }
  const action = String(b.action ?? '') as HostAction;
  if (!HOST_ACTIONS.includes(action)) return NextResponse.json({ error: `action must be ${HOST_ACTIONS.join(', ')}` }, { status: 400 });
  // Reconcile off: provisioning would create and start containers, so it is refused here, not only hidden in the UI.
  if (action === 'provision' && (await reconcileOff())) {
    return NextResponse.json({ error: 'Reconcile is off (Settings → Reconcile, or SM_RECONCILE=0): provision would start containers. Nothing was sent.' }, { status: 409 });
  }
  const host = await prisma.host.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!host) return NextResponse.json({ error: 'No such host' }, { status: 404 });
  const ctl = getFleetControl();
  if (!ctl) return NextResponse.json({ error: 'Host commands are not available yet (needs the Phase 2 relay)' }, { status: 501 });
  const r = await ctl.run(id, action, b.args && typeof b.args === 'object' ? (b.args as Record<string, unknown>) : undefined);
  await audit(u.username, `host.${action}`, host.name, { ok: r.ok, message: r.message });
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
