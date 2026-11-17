import { NextResponse } from 'next/server';
import { asAdmin } from '@/lib/control/admin-route';
import { readJson } from '@/lib/control/errors';
import { createMode, listModeViews } from '@/lib/control/registry';
import { audit } from '@/lib/audit';
import { publish } from '@/lib/control/events';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: P) {
  return asAdmin(async () => NextResponse.json(await listModeViews((await ctx.params).id)));
}

export async function POST(req: Request, ctx: P) {
  return asAdmin(async (u) => {
    const { id } = await ctx.params;
    const b = await readJson(req);
    const m = await createMode(id, b);
    await audit(u.username, 'mode.create', `${id}/${m.name}`, b);
    publish({ type: 'mode.create', appId: id, data: { mode: m.name } });
    return NextResponse.json(m, { status: 201 });
  });
}
