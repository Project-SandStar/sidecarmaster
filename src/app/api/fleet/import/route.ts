import { NextResponse } from 'next/server';
import { importSoundSuite, sourceFromEnv } from '@/lib/importer/run';
import { requireApiUser } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Run the Sound Suite import now. Body { dryRun?: boolean }. Reads Sound Suite only. */
export async function POST(req: Request) {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  const src = sourceFromEnv();
  if (!src) return NextResponse.json({ error: 'No Sound Suite source configured (SM_SOUNDSUITE_SYSTEM_DB)' }, { status: 409 });
  let body: { dryRun?: unknown } = {};
  try { body = await req.json(); } catch { /* none */ }
  try {
    const r = await importSoundSuite(src, body.dryRun === true);
    await audit(u.username, body.dryRun === true ? 'import.soundsuite.dry' : 'import.soundsuite', null, { hosts: r.hosts, roles: r.roles });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: `Import failed: ${e instanceof Error ? e.message : e}` }, { status: 500 });
  }
}
