import { NextResponse } from 'next/server';
import { asAdmin } from '@/lib/control/admin-route';
import { ControlError, readJson } from '@/lib/control/errors';
import { audit } from '@/lib/audit';
import {
  ENV_LOCK_TEXT, PREVIEW_MAX_AGE_MS, getLastPreview, getLastRun, previewIsFresh, reconcileSwitch, setReconcileEnabled,
} from '@/lib/control/reconcile-switch';

export const dynamic = 'force-dynamic';

async function view() {
  const [sw, lastRun, lastPreview] = await Promise.all([reconcileSwitch(), getLastRun(), getLastPreview()]);
  return { ...sw, lockText: sw.lockedByEnv ? ENV_LOCK_TEXT : null, lastRun, lastPreview, previewMaxAgeMs: PREVIEW_MAX_AGE_MS };
}

/** Switch state, last run and last preview for Settings → Reconcile. */
export async function GET() {
  return asAdmin(async () => NextResponse.json(await view()));
}

/**
 * PUT { enabled, previewId? }. Turning ON needs the id of a fresh preview (POST .../preview) and is
 * refused while SM_RECONCILE=0 locks it. Turning OFF always works. Both write an audit row.
 */
export async function PUT(req: Request) {
  return asAdmin(async (u) => {
    const b = await readJson(req);
    if (typeof b.enabled !== 'boolean') throw new ControlError('enabled must be true or false');
    const sw = await reconcileSwitch();
    if (b.enabled) {
      if (sw.lockedByEnv) {
        await audit(u.username, 'reconcile.enable.refused', null, { reason: 'env-lock' });
        throw new ControlError(`Reconcile is ${ENV_LOCK_TEXT}. Remove that line and restart to use this switch.`, 409);
      }
      const p = await getLastPreview();
      if (!previewIsFresh(p, b.previewId)) {
        await audit(u.username, 'reconcile.enable.refused', null, { reason: 'no-fresh-preview' });
        throw new ControlError('Run a preview first (it must be the newest one and less than 10 minutes old).', 409);
      }
      await setReconcileEnabled(true);
      await audit(u.username, 'reconcile.enable', null, { from: sw.setting, previewId: p!.id, previewAt: p!.at, stops: p!.stops, starts: p!.starts, pushes: p!.pushes });
    } else {
      await setReconcileEnabled(false);
      await audit(u.username, 'reconcile.disable', null, { from: sw.setting });
    }
    return NextResponse.json(await view());
  });
}
