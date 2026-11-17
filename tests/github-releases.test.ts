import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { buildFromVersion, syncGithubRelease } from '@/lib/github-releases';
import { latestRelease } from '@/lib/updates';

const SHA = 'a'.repeat(64);
const ok = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });

function fakeGithub(rel: Record<string, unknown>, manifest: Record<string, unknown>) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    if (url.startsWith('https://api.github.com/')) return url.includes('/tags/v9.9.9') ? new Response('', { status: 404 }) : ok(rel);
    if (url.endsWith('/manifest.json')) return ok(manifest);
    return new Response('', { status: 404 });
  };
  return { fetcher, calls };
}

const release = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v2.5.1', draft: false, prerelease: false, body: 'Release sidecar 2.5.1\nmore',
  assets: [
    { name: 'manifest.json', browser_download_url: 'https://github.com/o/r/releases/download/v2.5.1/manifest.json' },
    { name: 'sidecar-v2.5.1.tar.gz', browser_download_url: 'https://github.com/o/r/releases/download/v2.5.1/sidecar-v2.5.1.tar.gz', digest: `sha256:${SHA}` },
  ],
  ...over,
});
const manifest = { version: '2.5.1', filename: 'sidecar-v2.5.1.tar.gz', sha256: SHA };

describe('GitHub release sync', () => {
  it('build number grows with the version', () => {
    expect(buildFromVersion('2.5.1')).toBe(20501);
    expect(buildFromVersion('2.10.0')).toBeGreaterThan(buildFromVersion('2.9.99'));
    expect(() => buildFromVersion('2.5')).toThrow();
  });

  it('imports the newest release once, as docker-sidecar/linux', async () => {
    const g = fakeGithub(release(), manifest);
    const r = await syncGithubRelease({}, 'test', g.fetcher);
    expect(r).toMatchObject({ status: 'imported', version: '2.5.1', build: 20501 });
    expect(g.calls[0]).toBe('https://api.github.com/repos/Project-SandStar/SideCar/releases/latest');
    const e = await latestRelease('docker-sidecar', 'linux');
    expect(e).toMatchObject({ version: '2.5.1', build: 20501, sha256: SHA });
    const row = await prisma.release.findFirst({ where: { build: 20501 } });
    expect(row).toMatchObject({ source: 'github', url: expect.stringContaining('sidecar-v2.5.1.tar.gz'), notes: 'Release sidecar 2.5.1' });
    expect((await syncGithubRelease({}, 'test', g.fetcher)).status).toBe('exists');
  });

  it('refuses a digest that does not match the manifest; skips without manifest', async () => {
    const bad = release({ tag_name: 'v2.5.2', assets: [release().assets[0], { ...release().assets[1], name: 'sidecar-v2.5.2.tar.gz', digest: `sha256:${'b'.repeat(64)}` }] });
    await expect(syncGithubRelease({}, 't', fakeGithub(bad, { ...manifest, version: '2.5.2', filename: 'sidecar-v2.5.2.tar.gz' }).fetcher)).rejects.toThrow(/digest/);
    const none = release({ assets: [] });
    expect((await syncGithubRelease({}, 't', fakeGithub(none, manifest).fetcher)).status).toBe('skipped');
  });

  it('a missing tag gives a clear 404', async () => {
    await expect(syncGithubRelease({ tag: 'v9.9.9' }, 't', fakeGithub(release(), manifest).fetcher)).rejects.toThrow(/No GitHub release v9.9.9/);
  });
});
