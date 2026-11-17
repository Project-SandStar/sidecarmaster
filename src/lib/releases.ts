/**
 * Releases page back end: add a release (upload or URL), import from a GitLab release,
 * roll out per host or to all, delete, per-host version view.
 * Uploaded files live in SM_RELEASES_DIR (default data/releases) and are served by
 * GET /api/releases/files/<id>/<name>.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from './db';
import { getSetting } from './settings';
import { CHANNELS, PLATFORMS, PRODUCTS, ROLLOUTS } from './updates';

export class ReleaseError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export const SHA_RE = /^[0-9a-f]{64}$/;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,40}$/;
// No leading dot: blocks '.', '..' and hidden files.
const FILE_RE = /^[A-Za-z0-9_+-][A-Za-z0-9._+-]{0,199}$/;
export const MAX_UPLOAD = 512 * 1024 * 1024;

export function releasesDir(): string {
  const d = process.env.SM_RELEASES_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), 'data', 'releases');
  return path.isAbsolute(d) ? d : path.join(/*turbopackIgnore: true*/ process.cwd(), d);
}
export function publicBase(): string {
  return (process.env.SM_PUBLIC_URL ?? 'http://localhost:3010').replace(/\/+$/, '');
}

export interface ReleaseInput {
  product: string; platform: string; channel?: string; version: string; build: number | string;
  url?: string; sha256?: string; notes?: string | null; minOS?: string | null; rollout?: string;
}

export function validateRelease(i: ReleaseInput) {
  return check(i);
}

function check(i: ReleaseInput) {
  if (!(PRODUCTS as readonly string[]).includes(i.product)) throw new ReleaseError(`Product must be ${PRODUCTS.join(' or ')}`);
  if (!(PLATFORMS as readonly string[]).includes(i.platform)) throw new ReleaseError(`Platform must be ${PLATFORMS.join(', ')}`);
  const channel = i.channel || 'stable';
  if (!(CHANNELS as readonly string[]).includes(channel)) throw new ReleaseError('Channel must be stable or beta');
  if (!VERSION_RE.test(String(i.version ?? ''))) throw new ReleaseError('Version is missing or has bad characters');
  const build = Number(i.build);
  if (!Number.isInteger(build) || build < 1 || build > 2_000_000_000) throw new ReleaseError('Build must be a whole number above 0');
  const rollout = i.rollout || 'all';
  if (!(ROLLOUTS as readonly string[]).includes(rollout)) throw new ReleaseError('Rollout must be all, hosts or none');
  const notes = i.notes ? String(i.notes).slice(0, 4000) : null;
  const minOS = i.minOS ? String(i.minOS).trim().slice(0, 40) : null;
  return { product: i.product, platform: i.platform, channel, version: String(i.version), build, notes, minOS, rollout };
}

function checkUrl(u: string | undefined): string {
  let url: URL;
  try { url = new URL(String(u ?? '')); } catch { throw new ReleaseError('Download URL is not a valid URL'); }
  if (url.protocol !== 'https:') throw new ReleaseError('Download URL must use https');
  return url.toString();
}

export async function createRelease(data: Parameters<typeof create>[0]) {
  return create(data);
}

async function create(data: ReturnType<typeof check> & { url: string; sha256: string; source: string; createdBy: string; filePath?: string | null; fileName?: string | null; size?: number | null; gitlabTag?: string | null }) {
  const dup = await prisma.release.findUnique({ where: { product_platform_channel_build: { product: data.product, platform: data.platform, channel: data.channel, build: data.build } } });
  if (dup) throw new ReleaseError(`Build ${data.build} of ${data.product}/${data.platform} (${data.channel}) exists already`, 409);
  return prisma.release.create({ data });
}

/** Release with a download URL that lives somewhere else (GitLab package, CDN). */
export async function addReleaseByUrl(i: ReleaseInput, actor: string) {
  const c = check(i);
  const sha256 = String(i.sha256 ?? '').trim().toLowerCase();
  if (!SHA_RE.test(sha256)) throw new ReleaseError('SHA-256 must be 64 hex characters');
  return create({ ...c, url: checkUrl(i.url), sha256, source: 'manual', createdBy: actor });
}

/** Uploaded build: sidecarmaster stores the file, computes the SHA-256 and serves it. */
export async function addReleaseUpload(i: ReleaseInput, file: { name: string; data: Buffer }, actor: string) {
  const c = check(i);
  const name = path.basename(file.name);
  if (!FILE_RE.test(name)) throw new ReleaseError('File name may use only letters, digits, . _ + -');
  if (file.data.length === 0) throw new ReleaseError('The file is empty');
  if (file.data.length > MAX_UPLOAD) throw new ReleaseError('The file is larger than 512 MB', 413);
  const sha256 = crypto.createHash('sha256').update(file.data).digest('hex');
  if (i.sha256 && String(i.sha256).trim().toLowerCase() !== sha256) {
    throw new ReleaseError('The file does not match the SHA-256 you gave. Upload refused.');
  }
  const id = crypto.randomBytes(8).toString('hex');
  const dir = path.join(releasesDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, file.data, { mode: 0o644 });
  try {
    return await create({
      ...c, sha256, url: `${publicBase()}/api/releases/files/${id}/${encodeURIComponent(name)}`,
      source: 'upload', filePath: path.join(id, name), fileName: name, size: file.data.length, createdBy: actor,
    });
  } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
}

/** Local path for /api/releases/files/<id>/<name>, or null. Guards against path tricks. */
export function releaseFile(id: string, name: string): string | null {
  if (!/^[0-9a-f]{16}$/.test(id) || !FILE_RE.test(name)) return null;
  const p = path.join(releasesDir(), id, name);
  return fs.existsSync(p) && fs.statSync(p).isFile() ? p : null;
}

export async function setRollout(id: string, rollout: string, hostIds: string[] | undefined, actor: string) {
  if (!(ROLLOUTS as readonly string[]).includes(rollout)) throw new ReleaseError('Rollout must be all, hosts or none');
  const r = await prisma.release.findUnique({ where: { id } });
  if (!r) throw new ReleaseError('No such release', 404);
  if (hostIds) {
    const known = new Set((await prisma.host.findMany({ where: { id: { in: hostIds } }, select: { id: true } })).map((h) => h.id));
    const bad = hostIds.find((h) => !known.has(h));
    if (bad) throw new ReleaseError(`Unknown host: ${bad}`);
    await prisma.releaseHost.deleteMany({ where: { releaseId: id } });
    if (hostIds.length) await prisma.releaseHost.createMany({ data: hostIds.map((hostId) => ({ releaseId: id, hostId })) });
  }
  if (rollout === 'hosts' && (await prisma.releaseHost.count({ where: { releaseId: id } })) === 0) {
    throw new ReleaseError('Pick at least one host for a per-host rollout');
  }
  void actor;
  return prisma.release.update({ where: { id }, data: { rollout }, include: { hosts: true } });
}

export async function deleteRelease(id: string) {
  const r = await prisma.release.findUnique({ where: { id } });
  if (!r) throw new ReleaseError('No such release', 404);
  await prisma.release.delete({ where: { id } });
  if (r.filePath) fs.rmSync(path.join(releasesDir(), path.dirname(r.filePath)), { recursive: true, force: true });
  return r;
}

export async function listReleases() {
  return prisma.release.findMany({ orderBy: [{ product: 'asc' }, { platform: 'asc' }, { channel: 'asc' }, { build: 'desc' }], include: { hosts: true } });
}

// ─── GitLab import ──────────────────────────────────────────────────────

export const GITLAB_PROJECT_URL = '';
export const GITLAB_TOKEN_KEY = 'releases.gitlab.token';
export const GITLAB_URL_KEY = 'releases.gitlab.projectUrl';

export interface GitlabLink { name: string; url: string; direct_asset_url?: string; link_type?: string }
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** "https://host/group/sub/project" → API base + encoded project path. */
export function gitlabApi(projectUrl: string): { api: string; project: string } {
  let u: URL;
  try { u = new URL(projectUrl); } catch { throw new ReleaseError('GitLab project URL is not valid'); }
  if (u.protocol !== 'https:') throw new ReleaseError('GitLab project URL must use https');
  const p = u.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  if (!p.includes('/')) throw new ReleaseError('GitLab project URL needs group/project');
  return { api: `${u.origin}/api/v4`, project: encodeURIComponent(p) };
}

/** Platform from an update-<platform>.json asset name. */
export function feedPlatform(name: string): string | null {
  const m = /^update-(macos|windows|linux)\.json$/.exec(name);
  return m ? m[1] : null;
}

export interface ImportResult { tag: string; imported: { platform: string; build: number; version: string }[]; skipped: string[] }

/**
 * Read a GitLab release: every update-<platform>.json link gives one feed entry
 * (fileSystemSideCar CI writes them). The URL in the JSON points to the package registry.
 */
export async function importGitlabRelease(
  opts: { tag: string; product?: string; channel?: string; projectUrl?: string; rollout?: string },
  actor: string, fetcher: Fetcher = fetch,
): Promise<ImportResult> {
  const tag = String(opts.tag ?? '').trim();
  if (!/^[A-Za-z0-9._+-]{1,64}$/.test(tag)) throw new ReleaseError('Tag is missing or has bad characters');
  const product = opts.product || 'filesystem-sidecar';
  const channel = opts.channel || 'stable';
  const projectUrl = opts.projectUrl || (await getSetting(GITLAB_URL_KEY)) || GITLAB_PROJECT_URL;
  const token = await getSetting(GITLAB_TOKEN_KEY);
  if (!projectUrl) throw new ReleaseError('Set the GitLab project URL first');
  const { api, project } = gitlabApi(projectUrl);
  const headers: Record<string, string> = token ? { 'PRIVATE-TOKEN': token } : {};
  const scrub = (s: string) => (token ? s.split(token).join('***') : s);
  const get = async (url: string) => {
    let r: Response;
    try { r = await fetcher(url, { headers, signal: AbortSignal.timeout(20_000) }); }
    catch (e) { throw new ReleaseError(scrub(`GitLab not reachable: ${e instanceof Error ? e.message : e}`), 502); }
    if (r.status === 401 || r.status === 403) throw new ReleaseError('GitLab refused the token. Check it in Releases > GitLab token.', 502);
    if (r.status === 404) throw new ReleaseError(`Not found on GitLab: ${url.startsWith(api) ? `release ${tag}` : 'asset'}`, 404);
    if (!r.ok) throw new ReleaseError(`GitLab answered HTTP ${r.status}`, 502);
    return r;
  };
  const rel = (await (await get(`${api}/projects/${project}/releases/${encodeURIComponent(tag)}`)).json()) as { tag_name?: string; assets?: { links?: GitlabLink[] } };
  const links = rel.assets?.links ?? [];
  const feeds = links.filter((l) => feedPlatform(l.name));
  if (feeds.length === 0) throw new ReleaseError(`Release ${tag} has no update-<platform>.json asset`);
  const res: ImportResult = { tag, imported: [], skipped: [] };
  for (const l of feeds) {
    const platform = feedPlatform(l.name)!;
    let j: Record<string, unknown>;
    try { j = (await (await get(l.direct_asset_url || l.url)).json()) as Record<string, unknown>; }
    catch (e) { res.skipped.push(`${platform}: ${e instanceof Error ? e.message : e}`); continue; }
    try {
      const c = check({ product, platform, channel, version: String(j.version ?? ''), build: j.build as number, notes: (j.notes as string) ?? null, minOS: (j.minOS as string) ?? null, rollout: opts.rollout });
      const sha256 = String(j.sha256 ?? '').toLowerCase();
      if (!SHA_RE.test(sha256)) throw new ReleaseError('sha256 in the update JSON is not 64 hex characters');
      await create({ ...c, url: checkUrl(j.url as string), sha256, source: 'gitlab', gitlabTag: tag, createdBy: actor });
      res.imported.push({ platform, build: c.build, version: c.version });
    } catch (e) { res.skipped.push(`${platform}: ${e instanceof Error ? e.message : e}`); }
  }
  return res;
}

// ─── Per-host versions ──────────────────────────────────────────────────

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
