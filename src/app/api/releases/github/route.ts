import { NextResponse } from 'next/server';
import { GITHUB_AUTO_KEY, GITHUB_REPO_KEY, GITHUB_ROLLOUT_KEY, GITHUB_SYNC_MIN, githubSettings, validRepo } from '@/lib/github-releases';
import { deleteSetting, setSetting } from '@/lib/settings';
import { ROLLOUTS } from '@/lib/updates';
import { requireApiUser } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const view = async () => ({ ...(await githubSettings()), intervalMin: GITHUB_SYNC_MIN });

/** GitHub sync settings: repo (owner/name), auto (every 15 min), rollout for imported builds. */
export async function GET() {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  return NextResponse.json(await view());
}

export async function PUT(req: Request) {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  let b: { repo?: unknown; auto?: unknown; rollout?: unknown } = {};
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }); }
  if (b.repo !== undefined) {
    const r = String(b.repo).trim();
    if (r && !validRepo(r)) return NextResponse.json({ error: 'Repo must be owner/name' }, { status: 400 });
    if (r) await setSetting(GITHUB_REPO_KEY, r); else await deleteSetting(GITHUB_REPO_KEY);
  }
  if (b.auto !== undefined) await setSetting(GITHUB_AUTO_KEY, b.auto ? '1' : '0');
  if (b.rollout !== undefined) {
    if (!(ROLLOUTS as readonly string[]).includes(String(b.rollout))) return NextResponse.json({ error: 'Rollout must be all, hosts or none' }, { status: 400 });
    await setSetting(GITHUB_ROLLOUT_KEY, String(b.rollout));
  }
  await audit(u.username, 'settings.releases.github', null, b);
  return NextResponse.json(await view());
}
