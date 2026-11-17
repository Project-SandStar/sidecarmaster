'use client';
/** Releases page forms: add (upload or URL), import from GitLab or GitHub, GitLab token, rollout. */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type Msg = { ok: boolean; text: string } | null;
const Note = ({ m }: { m: Msg }) => (m ? <p className={`text-sm ${m.ok ? 'text-green-700' : 'text-red-700'}`}>{m.text}</p> : null);
const err = async (r: Response) => ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Error ${r.status}`;

export function AddReleaseForm() {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const fd = new FormData(e.currentTarget);
    const f = fd.get('file');
    if (f && typeof f !== 'string' && f.size === 0) fd.delete('file');
    const r = await fetch('/api/releases', { method: 'POST', body: fd });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: await err(r) }); return; }
    setMsg({ ok: true, text: 'Release added.' }); router.refresh();
  }
  const sel = (name: string, opts: string[]) => <select name={name} className="input mt-1">{opts.map((o) => <option key={o}>{o}</option>)}</select>;
  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="font-medium">Add a release</div>
      <div className="grid grid-cols-4 gap-3 text-xs text-gray-600">
        <label>Product{sel('product', ['filesystem-sidecar', 'docker-sidecar'])}</label>
        <label>Platform{sel('platform', ['macos', 'windows', 'linux'])}</label>
        <label>Channel{sel('channel', ['stable', 'beta'])}</label>
        <label>Rollout{sel('rollout', ['all', 'none'])}</label>
        <label>Version<input name="version" className="input mt-1" placeholder="0.2.0" required /></label>
        <label>Build<input name="build" type="number" min={1} className="input mt-1" placeholder="12" required /></label>
        <label>Min OS<input name="minOS" className="input mt-1" placeholder="13.0" /></label>
        <label>SHA-256 (needed for a URL)<input name="sha256" className="input mt-1 font-mono" /></label>
        <label className="col-span-2">Upload a build<input name="file" type="file" className="input mt-1" /></label>
        <label className="col-span-2">…or a download URL (https)<input name="url" className="input mt-1" /></label>
        <label className="col-span-4">Notes<input name="notes" className="input mt-1" /></label>
      </div>
      <Note m={msg} />
      <button className="btn" disabled={busy}>{busy ? 'Working…' : 'Add release'}</button>
    </form>
  );
}

export function GithubSyncForm() {
  const router = useRouter();
  const [gh, setGh] = useState<{ repo: string; auto: boolean; rollout: string; intervalMin: number } | null>(null);
  const [tag, setTag] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch('/api/releases/github').then(async (r) => { if (r.ok) setGh(await r.json()); }); }, []);
  async function sync(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const r = await fetch('/api/releases/github/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag: tag.trim() }) });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: await err(r) }); return; }
    const j = (await r.json()) as { tag: string; version?: string; build?: number; status: string; reason?: string };
    const text = j.status === 'imported' ? `Imported ${j.tag} as build ${j.build}.` : j.status === 'exists' ? `${j.tag} is already here (build ${j.build}).` : `Skipped ${j.tag}: ${j.reason}`;
    setMsg({ ok: j.status !== 'skipped', text }); router.refresh();
  }
  async function save() {
    if (!gh) return;
    const r = await fetch('/api/releases/github', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: gh.repo, auto: gh.auto, rollout: gh.rollout }) });
    if (!r.ok) { setMsg({ ok: false, text: await err(r) }); return; }
    setGh(await r.json()); setMsg({ ok: true, text: 'GitHub settings saved.' });
  }
  return (
    <form onSubmit={sync} className="card space-y-3">
      <div className="font-medium">Docker sidecar from GitHub releases</div>
      <p className="text-xs text-gray-600">Imports the newest release of the public repo as docker-sidecar / linux.{gh?.auto ? ` Checks every ${gh.intervalMin} min.` : ''}</p>
      <div className="grid grid-cols-4 gap-3 text-xs text-gray-600">
        <label className="col-span-2">Repo (owner/name)<input className="input mt-1" value={gh?.repo ?? ''} onChange={(e) => gh && setGh({ ...gh, repo: e.target.value })} /></label>
        <label>Rollout for new builds<select className="input mt-1" value={gh?.rollout ?? 'all'} onChange={(e) => gh && setGh({ ...gh, rollout: e.target.value })}><option>all</option><option>none</option></select></label>
        <label className="flex items-end gap-2"><input type="checkbox" checked={gh?.auto ?? true} onChange={(e) => gh && setGh({ ...gh, auto: e.target.checked })} />Check automatically</label>
        <label>Tag (empty = newest)<input className="input mt-1" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="v2.5.1" /></label>
      </div>
      <Note m={msg} />
      <div className="flex gap-2">
        <button className="btn" disabled={busy}>{busy ? 'Syncing…' : 'Sync now'}</button>
        <button type="button" className="btn-ghost" onClick={save}>Save GitHub settings</button>
      </div>
    </form>
  );
}

export function GitlabImportForm() {
  const router = useRouter();
  const [tag, setTag] = useState(''); const [channel, setChannel] = useState('stable'); const [product, setProduct] = useState('filesystem-sidecar');
  const [msg, setMsg] = useState<Msg>(null); const [busy, setBusy] = useState(false);
  const [gl, setGl] = useState<{ projectUrl: string; hasToken: boolean; tokenHint: string | null } | null>(null);
  const [token, setToken] = useState(''); const [projectUrl, setProjectUrl] = useState('');
  useEffect(() => { fetch('/api/releases/gitlab').then(async (r) => { if (r.ok) { const j = await r.json(); setGl(j); setProjectUrl(j.projectUrl); } }); }, []);
  async function run(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const r = await fetch('/api/releases/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag, channel, product }) });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: await err(r) }); return; }
    const j = (await r.json()) as { imported: { platform: string; build: number }[]; skipped: string[] };
    setMsg({ ok: j.imported.length > 0, text: `Imported: ${j.imported.map((x) => `${x.platform} #${x.build}`).join(', ') || 'none'}${j.skipped.length ? `. Skipped: ${j.skipped.join('; ')}` : ''}` });
    router.refresh();
  }
  async function saveGl() {
    setMsg(null);
    const body: Record<string, string> = { projectUrl };
    if (token) body.token = token;
    const r = await fetch('/api/releases/gitlab', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { setMsg({ ok: false, text: await err(r) }); return; }
    setGl(await r.json()); setToken(''); setMsg({ ok: true, text: 'GitLab settings saved.' });
  }
  return (
    <form onSubmit={run} className="card space-y-3">
      <div className="font-medium">Import from GitLab release</div>
      <p className="text-xs text-gray-500">Reads the update-&lt;platform&gt;.json assets of the release (CI and scripts/release.sh write them).</p>
      <div className="grid grid-cols-4 gap-3 text-xs text-gray-600">
        <label>Tag<input className="input mt-1" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="v0.2.0" required /></label>
        <label>Product<select className="input mt-1" value={product} onChange={(e) => setProduct(e.target.value)}><option>filesystem-sidecar</option><option>docker-sidecar</option></select></label>
        <label>Channel<select className="input mt-1" value={channel} onChange={(e) => setChannel(e.target.value)}><option>stable</option><option>beta</option></select></label>
        <div className="flex items-end"><button className="btn" disabled={busy}>{busy ? 'Importing…' : 'Import'}</button></div>
        <label className="col-span-2">GitLab project URL<input className="input mt-1" value={projectUrl} onChange={(e) => setProjectUrl(e.target.value)} /></label>
        <label>GitLab token<input type="password" autoComplete="new-password" className="input mt-1" value={token} onChange={(e) => setToken(e.target.value)} placeholder={gl?.hasToken ? `Saved, ends in ${gl.tokenHint}` : 'read_api token'} /></label>
        <div className="flex items-end"><button type="button" className="btn-ghost" onClick={saveGl}>Save GitLab settings</button></div>
      </div>
      <Note m={msg} />
    </form>
  );
}

export function RolloutControl({ id, rollout, hostIds, hosts }: { id: string; rollout: string; hostIds: string[]; hosts: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string[]>(hostIds);
  const [e, setE] = useState<string | null>(null);
  async function send(r: string, ids?: string[]) {
    setE(null);
    const res = await fetch(`/api/releases/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rollout: r, hostIds: ids }) });
    if (!res.ok) { setE(await err(res)); return; }
    setOpen(false); router.refresh();
  }
  return (
    <div className="text-xs space-y-1">
      <div className="space-x-1">
        <button type="button" className={`btn-ghost !px-2 !py-1 ${rollout === 'all' ? '!bg-green-50' : ''}`} onClick={() => send('all')}>All</button>
        <button type="button" className={`btn-ghost !px-2 !py-1 ${rollout === 'hosts' ? '!bg-blue-50' : ''}`} onClick={() => setOpen(!open)}>Hosts…</button>
        <button type="button" className={`btn-ghost !px-2 !py-1 ${rollout === 'none' ? '!bg-gray-100' : ''}`} onClick={() => send('none')}>Hold</button>
      </div>
      {open && (
        <div className="border rounded p-2 space-y-1">
          {hosts.map((h) => (
            <label key={h.id} className="flex gap-2"><input type="checkbox" checked={pick.includes(h.id)} onChange={(ev) => setPick(ev.target.checked ? [...pick, h.id] : pick.filter((x) => x !== h.id))} />{h.name}</label>
          ))}
          <button type="button" className="btn !px-2 !py-1" onClick={() => send('hosts', pick)}>Roll out to these hosts</button>
        </div>
      )}
      {e && <div className="text-red-700">{e}</div>}
    </div>
  );
}
