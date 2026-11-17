import { NextResponse } from 'next/server';
import { asAdmin } from '@/lib/control/admin-route';
import { ControlError, readJson } from '@/lib/control/errors';
import { deleteApp, getApp, listModeViews, updateApp } from '@/lib/control/registry';
import { audit } from '@/lib/audit';
import { publish } from '@/lib/control/events';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: P) {
  return asAdmin(async () => {
    const { id } = await ctx.params;
    const a = await getApp(id);
    if (!a) throw new ControlError(`No app "${id}"`, 404);
    return NextResponse.json({ ...a, modes: await listModeViews(id) });
  });
}

export async function PUT(req: Request, ctx: P) {
  return asAdmin(async (u) => {
    const { id } = await ctx.params;
    const b = await readJson(req);
    const a = await updateApp(id, b);
    await audit(u.username, 'app.update', id, b);
    publish({ type: 'app.update', appId: id });
    return NextResponse.json(a);
  });
}

export async function DELETE(_req: Request, ctx: P) {
  return asAdmin(async (u) => {
    const { id } = await ctx.params;
    await deleteApp(id);
    await audit(u.username, 'app.delete', id);
    publish({ type: 'app.delete', appId: id });
    return NextResponse.json({ ok: true });
  });
}
