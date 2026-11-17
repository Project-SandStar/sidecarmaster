import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Liveness + DB check. No login. No secrets. */
export async function GET() {
  let db = 'ok';
  try { await prisma.$queryRawUnsafe('select 1'); } catch { db = 'error'; }
  const ok = db === 'ok';
  return NextResponse.json(
    { ok, service: 'sidecarmaster', version: process.env.APP_VERSION ?? 'dev', db, time: new Date().toISOString() },
    { status: ok ? 200 : 503 },
  );
}
