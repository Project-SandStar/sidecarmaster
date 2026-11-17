import { NextResponse } from 'next/server';
import { requireScope } from '@/lib/control/tokens';
import { modeCatalog } from '@/lib/control/fleet-view';

export const dynamic = 'force-dynamic';

/**
 * Task 3.7: mode catalog for sidecars (?os=linux|mac-docker-ollama|windows-docker-wsl2).
 * Sidecars get the same data in the `registry` of every config push; this is the pull fallback.
 * Auth: fleet:read token or admin. Phase 2 adds the per-host token.
 */
export async function GET(req: Request) {
  const c = await requireScope(req, 'fleet:read');
  if (c instanceof NextResponse) return c;
  return NextResponse.json(await modeCatalog(new URL(req.url).searchParams.get('os')));
}
