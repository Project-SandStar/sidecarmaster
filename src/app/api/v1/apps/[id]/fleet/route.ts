import { NextResponse } from 'next/server';
import { requireScope } from '@/lib/control/tokens';
import { appFleetView } from '@/lib/control/fleet-view';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ id: string }> };

/** Desired + live fleet for one app (scope fleet:read). Sound Suite `follow` reads this. */
export async function GET(req: Request, ctx: P) {
  const { id } = await ctx.params;
  const c = await requireScope(req, 'fleet:read', id);
  if (c instanceof NextResponse) return c;
  const v = await appFleetView(id);
  return v ? NextResponse.json(v) : NextResponse.json({ error: `No app "${id}"` }, { status: 404 });
}
