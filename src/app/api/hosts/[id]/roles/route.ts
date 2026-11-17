import { NextResponse } from 'next/server';
import { asAdmin } from '@/lib/control/admin-route';
import { readJson, str } from '@/lib/control/errors';
import { deleteRole, setRole } from '@/lib/control/roles';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ id: string }> };

const target = async (hostId: string, appId: string, mode: string) => {
  const h = await prisma.host.findUnique({ where: { id: hostId }, select: { name: true } });
  return `${h?.name ?? hostId}:${appId}/${mode}`;
};

/** Body: { appId, mode, enabled?, minOnline?, idleTimeoutMin?, modelOverride?, runtime? } */
export async function PUT(req: Request, ctx: P) {
  return asAdmin(async (u) => {
    const { id } = await ctx.params;
    const b = await readJson(req);
    const appId = str(b.appId, 'appId')!, mode = str(b.mode, 'mode')!;
    const r = await setRole(id, appId, mode, b);
    await audit(u.username, 'role.set', await target(id, appId, mode), b);
    return NextResponse.json(r);
  });
}

export async function DELETE(req: Request, ctx: P) {
  return asAdmin(async (u) => {
    const { id } = await ctx.params;
    const q = new URL(req.url).searchParams;
    const appId = str(q.get('appId'), 'appId')!, mode = str(q.get('mode'), 'mode')!;
    await deleteRole(id, appId, mode);
    await audit(u.username, 'role.delete', await target(id, appId, mode));
    return NextResponse.json({ ok: true });
  });
}
