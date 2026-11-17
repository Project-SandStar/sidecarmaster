import { NextResponse } from 'next/server';
import { requireScope } from '@/lib/control/tokens';
import { guard, readJson, str } from '@/lib/control/errors';
import { setRole } from '@/lib/control/roles';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ id: string }> };

/** Set one role of this app on a host (scope fleet:write). Body: { hostId, mode, enabled?, minOnline?, ... } */
export async function PUT(req: Request, ctx: P) {
  const { id } = await ctx.params;
  const c = await requireScope(req, 'fleet:write', id);
  if (c instanceof NextResponse) return c;
  return guard(async () => {
    const b = await readJson(req);
    const hostId = str(b.hostId, 'hostId')!, mode = str(b.mode, 'mode')!;
    const r = await setRole(hostId, id, mode, b);
    await audit('admin' in c ? c.admin : `app:${c.appId}`, 'role.set', `${hostId}:${id}/${mode}`, b);
    return NextResponse.json(r);
  });
}
