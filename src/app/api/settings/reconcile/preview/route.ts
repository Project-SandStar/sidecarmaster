import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { asAdmin } from '@/lib/control/admin-route';
import { audit } from '@/lib/audit';
import { previewReconcile, stopList } from '@/lib/control/reconcile-plan';
import { saveLastPreview } from '@/lib/control/reconcile-switch';

export const dynamic = 'force-dynamic';

/** Dry run: per host, what reconcile WOULD do. Sends nothing to any sidecar. */
export async function POST() {
  return asAdmin(async (u) => {
    const plan = await previewReconcile();
    const id = randomUUID();
    const t = plan.totals;
    await saveLastPreview({ id, at: plan.at, by: u.username, stops: t.stop, starts: t.start, pushes: t.push });
    await audit(u.username, 'reconcile.preview', null, { id, hosts: plan.hosts.length, ...t });
    return NextResponse.json({ id, ...plan, stopList: stopList(plan) });
  });
}
