/**
 * Docker sidecar releases from the public GitHub mirror (Project-SandStar/SideCar).
 *
 * A GitHub release there has two assets, written by court-lens-mcp
 * scripts/publishSidecarGithub.sh: manifest.json { version, filename, sha256, size }
 * and the tarball. Sync turns the newest release (or one tag) into a
 * docker-sidecar / linux release here; sidecars then get it through
 * /api/admin/gpu/sidecars/version and /download. No token: the repo is public.
 *
 * Build number = major*10000 + minor*100 + patch (2.5.1 → 20501), so a newer
 * version always has a higher build.
 */
import { prisma } from './db';
import { ReleaseError, SHA_RE, createRelease, validateRelease, type Fetcher } from './releases';
import { getSetting } from './settings';
import { ROLLOUTS } from './updates';

export const GITHUB_REPO_DEFAULT = 'Project-SandStar/SideCar';
export const GITHUB_REPO_KEY = 'releases.github.repo';
export const GITHUB_AUTO_KEY = 'releases.github.auto';
export const GITHUB_ROLLOUT_KEY = 'releases.github.rollout';
export const GITHUB_SYNC_MIN = 15;
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

export interface GithubSettings { repo: string; auto: boolean; rollout: string }

export async function githubSettings(): Promise<GithubSettings> {
  const repo = (await getSetting(GITHUB_REPO_KEY)) || GITHUB_REPO_DEFAULT;
  const auto = (await getSetting(GITHUB_AUTO_KEY)) !== '0';
  const r = (await getSetting(GITHUB_ROLLOUT_KEY)) || 'all';
  return { repo, auto, rollout: (ROLLOUTS as readonly string[]).includes(r) ? r : 'all' };
}

export function validRepo(r: string): boolean { return REPO_RE.test(r); }

export function buildFromVersion(v: string): number {
  const m = /^(\d{1,4})\.(\d{1,2})\.(\d{1,2})$/.exec(v);
  if (!m) throw new ReleaseError(`Version ${v} is not major.minor.patch (minor and patch below 100)`);
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
}

interface GhAsset { name: string; browser_download_url: string; digest?: string | null }
interface GhRelease { tag_name: string; draft: boolean; prerelease: boolean; body?: string; assets: GhAsset[] }

export interface SyncResult { tag: string; version?: string; build?: number; status: 'imported' | 'exists' | 'skipped'; reason?: string }

/** Import the newest GitHub release (or `tag`). Safe to repeat: an existing build is left alone. */
export async function syncGithubRelease(
  opts: { tag?: string; rollout?: string; repo?: string } = {}, actor = 'github-sync', fetcher: Fetcher = fetch,
): Promise<SyncResult> {
  const s = await githubSettings();
  const repo = opts.repo || s.repo;
  if (!validRepo(repo)) throw new ReleaseError('GitHub repo must be owner/name');
  const tag = opts.tag?.trim();
  if (tag && !/^[A-Za-z0-9._+-]{1,64}$/.test(tag)) throw new ReleaseError('Tag has bad characters');
  const get = async (url: string, accept = 'application/vnd.github+json') => {
    let r: Response;
    try { r = await fetcher(url, { headers: { Accept: accept, 'User-Agent': 'sidecarmaster' }, signal: AbortSignal.timeout(20_000) }); }
    catch (e) { throw new ReleaseError(`GitHub not reachable: ${e instanceof Error ? e.message : e}`, 502); }
    if (r.status === 404) throw new ReleaseError(tag ? `No GitHub release ${tag} in ${repo}` : `No GitHub release in ${repo}`, 404);
    if (r.status === 403 || r.status === 429) throw new ReleaseError('GitHub rate limit reached; try again later', 502);
    if (!r.ok) throw new ReleaseError(`GitHub answered HTTP ${r.status}`, 502);
    return r;
  };
  const api = `https://api.github.com/repos/${repo}/releases/${tag ? `tags/${encodeURIComponent(tag)}` : 'latest'}`;
  const rel = (await (await get(api)).json()) as GhRelease;
  if (rel.draft) return { tag: rel.tag_name, status: 'skipped', reason: 'draft' };

  const man = rel.assets.find((a) => a.name === 'manifest.json');
  if (!man) return { tag: rel.tag_name, status: 'skipped', reason: 'no manifest.json asset' };
  const m = (await (await get(man.browser_download_url, 'application/octet-stream')).json()) as Record<string, unknown>;
  const version = String(m.version ?? '');
  const sha256 = String(m.sha256 ?? '').toLowerCase();
  if (!SHA_RE.test(sha256)) throw new ReleaseError('manifest.json sha256 is not 64 hex characters');
  const tarball = rel.assets.find((a) => a.name === m.filename);
  if (!tarball) return { tag: rel.tag_name, version, status: 'skipped', reason: `asset ${String(m.filename)} missing` };
  // GitHub computes a digest per asset; it must agree with the manifest.
  if (tarball.digest && tarball.digest !== `sha256:${sha256}`) {
    throw new ReleaseError(`${tarball.name}: GitHub digest does not match manifest.json`);
  }
  const build = buildFromVersion(version);
  const channel = rel.prerelease ? 'beta' : 'stable';
  const where = { product_platform_channel_build: { product: 'docker-sidecar', platform: 'linux', channel, build } };
  if (await prisma.release.findUnique({ where })) return { tag: rel.tag_name, version, build, status: 'exists' };

  const c = validateRelease({
    product: 'docker-sidecar', platform: 'linux', channel, version, build,
    notes: rel.body ? rel.body.split('\n')[0].slice(0, 400) : null, rollout: opts.rollout || s.rollout,
  });
  await createRelease({ ...c, url: tarball.browser_download_url, sha256, source: 'github', gitlabTag: rel.tag_name, createdBy: actor });
  return { tag: rel.tag_name, version, build, status: 'imported' };
}

/** Background sync every GITHUB_SYNC_MIN minutes while the setting is on. */
export function startGithubSync(log: (m: string) => void = console.log): void {
  const tick = async () => {
    try {
      if (!(await githubSettings()).auto) return;
      const r = await syncGithubRelease();
      if (r.status === 'imported') log(`[sidecarmaster] GitHub release ${r.tag} imported as docker-sidecar build ${r.build}`);
    } catch (e) { log(`[sidecarmaster] GitHub sync failed: ${e instanceof Error ? e.message : e}`); }
  };
  setTimeout(tick, 30_000).unref();
  setInterval(tick, GITHUB_SYNC_MIN * 60_000).unref();
}
