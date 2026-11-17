import { NextResponse } from 'next/server';
import { ReleaseError, addReleaseByUrl, addReleaseUpload, listReleases, type ReleaseInput } from '@/lib/releases';
import { requireApiUser } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  return NextResponse.json(await listReleases());
}

/**
 * Add a release. multipart/form-data with `file` = upload (sidecarmaster serves it);
 * JSON { url, sha256, ... } = a build that lives elsewhere.
 */
export async function POST(req: Request) {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  try {
    const ct = req.headers.get('content-type') ?? '';
    let r;
    if (ct.startsWith('multipart/form-data')) {
      const f = await req.formData();
      const file = f.get('file');
      const get = (k: string) => { const v = f.get(k); return typeof v === 'string' ? v : undefined; };
      const input: ReleaseInput = {
        product: get('product') ?? '', platform: get('platform') ?? '', channel: get('channel'), version: get('version') ?? '',
        build: get('build') ?? '', sha256: get('sha256') || undefined, notes: get('notes'), minOS: get('minOS'), rollout: get('rollout'),
      };
      if (file && typeof file !== 'string') {
        r = await addReleaseUpload(input, { name: file.name, data: Buffer.from(await file.arrayBuffer()) }, u.username);
      } else {
        r = await addReleaseByUrl({ ...input, url: get('url') }, u.username);
      }
    } else {
      let b: ReleaseInput;
      try { b = await req.json(); } catch { return NextResponse.json({ error: 'Body must be JSON or a form' }, { status: 400 }); }
      r = await addReleaseByUrl(b, u.username);
    }
    await audit(u.username, 'release.add', `${r.product}/${r.platform}/${r.channel}#${r.build}`, { version: r.version, source: r.source, sha256: r.sha256 });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof ReleaseError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
