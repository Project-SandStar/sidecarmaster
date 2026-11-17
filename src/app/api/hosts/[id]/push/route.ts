import { NextResponse } from 'next/server';
import { asAdmin } from '@/lib/control/admin-route';
import { pushConfig } from '@/lib/control/policy';
import { audit } from '@/lib/audit';
import { reconcileOff } from '@/lib/control/reconcile-switch';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ id: string }> };

/** Push the full config to one host now (needs the relay). Does nothing while reconcile is off. */
export async function POST(_req: Request, ctx: P) {
  return asAdmin(async (u) => {
    const { id } = await ctx.params;
    // Reconcile off: never push to sidecars. Answer 200 so the UI can say "saved only".
    if (await reconcileOff()) {
      await audit(u.username, 'host.push-config.skipped', id, { reason: 'reconcile-off' });
      return NextResponse.json({ hostId: id, ok: false, skipped: 'reconcile-off' });
    }
    const r = await pushConfig(id);
    await audit(u.username, 'host.push-config', id, r);
    return NextResponse.json(r, { status: r.skipped === 'no-host' ? 404 : r.skipped === 'no-relay' ? 503 : r.ok ? 200 : 502 });
  });
}
