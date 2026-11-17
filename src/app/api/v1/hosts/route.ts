import { NextResponse } from 'next/server';
import { requireScope } from '@/lib/control/tokens';
import { hostsView } from '@/lib/control/fleet-view';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const c = await requireScope(req, 'fleet:read');
  if (c instanceof NextResponse) return c;
  return NextResponse.json(await hostsView());
}
