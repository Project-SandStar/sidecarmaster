import { NextResponse } from 'next/server';
import { asAdmin } from '@/lib/control/admin-route';
import { readJson } from '@/lib/control/errors';
import { setHostApp } from '@/lib/control/roles';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ id: string; appId: string }> };

/** Body: { enabled?, masterUrlOverride?, wsPortOverride?, notes? } */
export async function PUT(req: Request, ctx: P) {
  return asAdmin(async (u) => {
    const { id, appId } = await ctx.params;
    const b = await readJson(req);
    const r = await setHostApp(id, appId, b);
    await audit(u.username, 'hostapp.set', `${id}:${appId}`, b);
    return NextResponse.json(r);
  });
}
