import { NextResponse } from 'next/server';
import { GITLAB_PROJECT_URL, GITLAB_TOKEN_KEY, GITLAB_URL_KEY, ReleaseError, gitlabApi } from '@/lib/releases';
import { deleteSetting, getSetting, setSetting } from '@/lib/settings';
import { secretHint } from '@/lib/crypto';
import { requireApiUser } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

async function view() {
  const t = await getSetting(GITLAB_TOKEN_KEY);
  return { projectUrl: (await getSetting(GITLAB_URL_KEY)) || GITLAB_PROJECT_URL, hasToken: !!t, tokenHint: secretHint(t) };
}

/** GitLab settings for "Import from GitLab release". The token is stored encrypted and never returned. */
export async function GET() {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  return NextResponse.json(await view());
}

export async function PUT(req: Request) {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  let b: { projectUrl?: unknown; token?: unknown } = {};
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }); }
  try {
    if (b.projectUrl !== undefined) {
      const p = String(b.projectUrl).trim();
      if (p) { gitlabApi(p); await setSetting(GITLAB_URL_KEY, p); } else await deleteSetting(GITLAB_URL_KEY);
    }
    if (b.token !== undefined) {
      const t = String(b.token).trim();
      if (t) await setSetting(GITLAB_TOKEN_KEY, t, true); else await deleteSetting(GITLAB_TOKEN_KEY);
    }
  } catch (e) {
    if (e instanceof ReleaseError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  await audit(u.username, 'settings.releases.gitlab', null, b);
  return NextResponse.json(await view());
}
