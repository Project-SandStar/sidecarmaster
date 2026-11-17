import { NextResponse } from 'next/server';
import { asAdmin } from '@/lib/control/admin-route';
import { runReconcilePass } from '@/lib/control/reconcile';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Run one reconcile pass and the min-online rule now. Does nothing while reconcile is off. */
export async function POST() {
  return asAdmin(async (u) => {
    const r = await runReconcilePass();
    await audit(u.username, 'control.reconcile', null, { fixes: r.fixes.length, done: r.done.length, failed: r.failed.length, skipped: r.skipped });
    const status = r.skipped === 'reconcile-off' ? 409 : r.skipped ? 503 : 200;
    return NextResponse.json(r, { status });
  });
}
