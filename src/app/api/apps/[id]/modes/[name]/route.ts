import { NextResponse } from 'next/server';
import { asAdmin } from '@/lib/control/admin-route';
import { readJson } from '@/lib/control/errors';
import { deleteMode, updateMode } from '@/lib/control/registry';
import { audit } from '@/lib/audit';
import { publish } from '@/lib/control/events';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ id: string; name: string }> };

export async function PUT(req: Request, ctx: P) {
  return asAdmin(async (u) => {
    const { id, name } = await ctx.params;
    const b = await readJson(req);
    const m = await updateMode(id, name, b);
    await audit(u.username, 'mode.update', `${id}/${name}`, b);
    publish({ type: 'mode.update', appId: id, data: { mode: name } });
    return NextResponse.json(m);
  });
}

export async function DELETE(_req: Request, ctx: P) {
  return asAdmin(async (u) => {
    const { id, name } = await ctx.params;
    await deleteMode(id, name);
    await audit(u.username, 'mode.delete', `${id}/${name}`);
    publish({ type: 'mode.delete', appId: id, data: { mode: name } });
    return NextResponse.json({ ok: true });
  });
}
