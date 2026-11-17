import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { setSetting } from '@/lib/settings';
import { latestRelease } from '@/lib/updates';
import { addReleaseByUrl, addReleaseUpload, compareVersions, deleteRelease, gitlabApi, importGitlabRelease, releaseFile, setRollout, GITLAB_TOKEN_KEY, GITLAB_URL_KEY } from '@/lib/releases';

const SHA = 'b'.repeat(64);

describe('releases', () => {
  beforeAll(() => { process.env.SM_RELEASES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-rel-')); });

  it('adds by URL with checks', async () => {
    const base = { product: 'docker-sidecar', platform: 'linux', version: '2.5.0', build: 50, url: 'https://x/a.tar.gz', sha256: SHA };
    await expect(addReleaseByUrl({ ...base, url: 'http://x/a' }, 'admin')).rejects.toThrow(/https/);
    await expect(addReleaseByUrl({ ...base, sha256: 'nope' }, 'admin')).rejects.toThrow(/SHA-256/);
    await expect(addReleaseByUrl({ ...base, product: 'other' }, 'admin')).rejects.toThrow(/Product/);
    await addReleaseByUrl(base, 'admin');
    await expect(addReleaseByUrl(base, 'admin')).rejects.toThrow(/exists/);
    expect((await latestRelease('docker-sidecar', 'linux'))?.build).toBe(50);
  });

  it('upload: stores the file, computes SHA-256, refuses a wrong SHA', async () => {
    const data = Buffer.from('fake build bytes');
    const sha = crypto.createHash('sha256').update(data).digest('hex');
    await expect(addReleaseUpload({ product: 'filesystem-sidecar', platform: 'windows', version: '0.2.0', build: 7, sha256: SHA }, { name: 'fs.zip', data }, 'admin')).rejects.toThrow(/does not match/);
    await expect(addReleaseUpload({ product: 'filesystem-sidecar', platform: 'windows', version: '0.2.0', build: 7 }, { name: '../evil zip', data }, 'admin')).rejects.toThrow(/File name/);
    const r = await addReleaseUpload({ product: 'filesystem-sidecar', platform: 'windows', version: '0.2.0', build: 7 }, { name: 'fs.zip', data }, 'admin');
    expect(r.sha256).toBe(sha);
    const m = /files\/([0-9a-f]{16})\/(.+)$/.exec(r.url)!;
    expect(fs.readFileSync(releaseFile(m[1], m[2])!)).toEqual(data);
    expect(releaseFile(m[1], '..')).toBeNull();
    await deleteRelease(r.id);
    expect(releaseFile(m[1], m[2])).toBeNull();
  });

  it('rollout: hold, per host, all', async () => {
    await prisma.host.create({ data: { id: 'host-a', name: 'Studio-Mac' } });
    const r = await addReleaseByUrl({ product: 'filesystem-sidecar', platform: 'macos', version: '0.5.0', build: 20, url: 'https://x/m.zip', sha256: SHA, rollout: 'none' }, 'admin');
    expect(await latestRelease('filesystem-sidecar', 'macos')).toBeNull();
    await expect(setRollout(r.id, 'hosts', [], 'admin')).rejects.toThrow(/at least one host/);
    await expect(setRollout(r.id, 'hosts', ['nope'], 'admin')).rejects.toThrow(/Unknown host/);
    await setRollout(r.id, 'hosts', ['host-a'], 'admin');
    expect(await latestRelease('filesystem-sidecar', 'macos')).toBeNull();
    expect((await latestRelease('filesystem-sidecar', 'macos', 'stable', 'studio-mac'))?.build).toBe(20);
    expect((await latestRelease('filesystem-sidecar', 'macos', 'stable', 'host-a'))?.build).toBe(20);
    await setRollout(r.id, 'all', undefined, 'admin');
    expect((await latestRelease('filesystem-sidecar', 'macos'))?.build).toBe(20);
  });

  it('imports a GitLab release from update-<platform>.json assets, sends the token, never leaks it', async () => {
    await setSetting(GITLAB_TOKEN_KEY, 'glpat-SECRET-1234', true);
    await setSetting(GITLAB_URL_KEY, 'https://gitlab.example.com/acme/tools/sidecar');
    const calls: { url: string; tok?: string }[] = [];
    const feed = (platform: string, build: number) => ({ version: '0.6.0', build, url: `https://gitlab.example.com/pkg/${platform}.zip`, sha256: 'c'.repeat(64), minOS: platform === 'macos' ? '13.0' : undefined });
    const fetcher = async (url: string, init?: RequestInit) => {
      calls.push({ url, tok: (init?.headers as Record<string, string>)['PRIVATE-TOKEN'] });
      const j = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
      if (url.includes('/releases/v0.6.0')) return j({ tag_name: 'v0.6.0', assets: { links: [
        { name: 'update-macos.json', url: 'https://gl/m.json' }, { name: 'update-linux.json', url: 'https://gl/l.json', direct_asset_url: 'https://gl/l-direct.json' },
        { name: 'fs-sidecar-linux.tar.gz', url: 'https://gl/x' }, { name: 'update-windows.json', url: 'https://gl/w.json' } ] } });
      if (url === 'https://gl/m.json') return j(feed('macos', 30));
      if (url === 'https://gl/l-direct.json') return j(feed('linux', 30));
      if (url === 'https://gl/w.json') return j({ ...feed('windows', 30), sha256: 'short' });
      return new Response('', { status: 404 });
    };
    const r = await importGitlabRelease({ tag: 'v0.6.0', channel: 'beta' }, 'admin', fetcher as typeof fetch);
    expect(r.imported.map((x) => x.platform).sort()).toEqual(['linux', 'macos']);
    expect(r.skipped[0]).toMatch(/windows: sha256/);
    expect(calls[0].url).toBe('https://gitlab.example.com/api/v4/projects/acme%2Ftools%2Fsidecar/releases/v0.6.0');
    expect(calls.every((c) => c.tok === 'glpat-SECRET-1234')).toBe(true);
    expect((await latestRelease('filesystem-sidecar', 'macos', 'beta'))).toMatchObject({ build: 30, minOS: '13.0' });
    const bad = async () => { throw new Error('connect failed glpat-SECRET-1234'); };
    await expect(importGitlabRelease({ tag: 'v0.6.0' }, 'admin', bad as typeof fetch)).rejects.toThrow(/\*\*\*/);
    await expect(importGitlabRelease({ tag: 'v0.6.0' }, 'admin', (async () => new Response('', { status: 401 })) as typeof fetch)).rejects.toThrow(/refused the token/);
  });

  it('helpers', () => {
    expect(gitlabApi('https://gitlab.example.com/a/b/c.git')).toEqual({ api: 'https://gitlab.example.com/api/v4', project: 'a%2Fb%2Fc' });
    expect(compareVersions('2.10.0', '2.9.1')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });
});
