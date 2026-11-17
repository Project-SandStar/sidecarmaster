import { NextResponse } from 'next/server';
import { asAdmin } from '@/lib/control/admin-route';
import { readJson } from '@/lib/control/errors';
import { createApp, listApps } from '@/lib/control/registry';
import { audit } from '@/lib/audit';
import { publish } from '@/lib/control/events';

export const dynamic = 'force-dynamic';

export async function GET() {
  return asAdmin(async () => NextResponse.json(await listApps()));
}

export async function POST(req: Request) {
  return asAdmin(async (u) => {
    const b = await readJson(req);
    const a = await createApp(b);
    await audit(u.username, 'app.create', a.id, b);
    publish({ type: 'app.create', appId: a.id });
    return NextResponse.json(a, { status: 201 });
  });
}
