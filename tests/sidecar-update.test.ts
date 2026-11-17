import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { addReleaseByUrl, addReleaseUpload, setRollout } from '@/lib/releases';
import { callerHostId, releaseBytes } from '@/lib/sidecar-update';

const req = (p: string, ip?: string) =>
  new Request(`http://x/api/admin/gpu/sidecars/${p}`, { headers: ip ? { 'x-forwarded-for': ip } : {} });

describe('sidecar self-update endpoints', () => {
  beforeAll(async () => {
    process.env.SM_RELEASES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-su-'));
    await prisma.host.create({ data: { id: 'h1', name: 'GPUWS42', lastSeenFromIp: '192.168.20.192' } });
    await prisma.host.create({ data: { id: 'h2', name: 'gpu-2', agentUrl: 'http://192.168.20.41:8098' } });
  });

  it('404 when there is no release', async () => {
    const { GET } = await import('@/app/api/admin/gpu/sidecars/version/route');
    expect((await GET(req('version'))).status).toBe(404);
  });

  it('finds the caller by ?host= or by IP; refuses to guess', async () => {
    expect(await callerHostId(req('version', '192.168.20.192'))).toBe('h1');
    expect(await callerHostId(req('version', '::ffff:192.168.20.41'))).toBe('h2');
    expect(await callerHostId(req('version?host=gpuws42'))).toBe('h1');
    expect(await callerHostId(req('version', '10.9.9.9'))).toBeNull();
  });

  it('per-host rollout reaches only that host; download carries version and hash', async () => {
    const data = Buffer.from('sidecar tarball bytes');
    const sha = crypto.createHash('sha256').update(data).digest('hex');
    const r = await addReleaseUpload(
      { product: 'docker-sidecar', platform: 'linux', version: '2.6.0', build: 260, rollout: 'none' },
      { name: 'sidecar-2.6.0.tar.gz', data }, 'admin');
    await setRollout(r.id, 'hosts', ['h1'], 'admin');

    const v = await import('@/app/api/admin/gpu/sidecars/version/route');
    expect((await v.GET(req('version', '192.168.20.41'))).status).toBe(404);
    const ok = await v.GET(req('version', '192.168.20.192'));
    expect(await ok.json()).toMatchObject({ version: '2.6.0', sha256: sha });

    const d = await import('@/app/api/admin/gpu/sidecars/download/route');
    const res = await d.GET(req('download', '192.168.20.192'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-sidecar-version')).toBe('2.6.0');
    expect(res.headers.get('x-sidecar-sha256')).toBe(sha);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(data);

    await setRollout(r.id, 'all', undefined, 'admin');
    expect((await v.GET(req('version', '192.168.20.41'))).status).toBe(200);
  });

  it('URL release: fetched and checked against its SHA-256', async () => {
    const data = Buffer.from('remote');
    const sha = crypto.createHash('sha256').update(data).digest('hex');
    const r = await addReleaseByUrl({ product: 'docker-sidecar', platform: 'linux', version: '2.6.1', build: 261, url: 'https://x/s.tar.gz', sha256: sha }, 'admin');
    const got = await releaseBytes(r, async () => new Response(data));
    expect(got).toEqual(data);
    expect(await releaseBytes(r, async () => new Response('x', { status: 404 }))).toBeNull();
  });
});
