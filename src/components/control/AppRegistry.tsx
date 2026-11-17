'use client';
/** App registry: add apps, edit master URLs, sidecar token and API token. Secrets show only their last 4 characters. */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AppView } from '@/lib/control/registry';
import { call, Msg } from './api';

const SCOPES = ['fleet:read', 'fleet:write', 'commands'];

function AppCard({ a }: { a: AppView }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ displayName: a.displayName, masterUrl: a.masterUrl ?? '', wsUrl: a.wsUrl ?? '', probeUrl: a.probeUrl ?? '', protocol: a.protocol, enabled: a.enabled, sidecarToken: '' });
  const [scopes, setScopes] = useState<string[]>(a.apiScopes.length ? a.apiScopes : ['fleet:read']);
  const [newToken, setNewToken] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); router.refresh(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  }
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const b: Record<string, unknown> = { displayName: f.displayName, masterUrl: f.masterUrl || null, wsUrl: f.wsUrl || null, probeUrl: f.probeUrl || null, protocol: f.protocol, enabled: f.enabled };
    if (f.sidecarToken) b.sidecarToken = f.sidecarToken;
    return run(async () => { await call(`/api/apps/${a.id}`, 'PUT', b); setF({ ...f, sidecarToken: '' }); }, 'Saved.');
  };
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-semibold">{a.displayName}</div><code className="text-xs text-gray-500">{a.id}</code>
        <span className="pill bg-gray-100 text-gray-600">{a.modeCount} modes</span>
        <span className="pill bg-gray-100 text-gray-600">{a.hostCount} hosts</span>
        <span className={`pill ${a.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>{a.enabled ? 'enabled' : 'off'}</span>
        <a className="text-sm text-blue-700 ml-auto" href={`/roletypes#${a.id}`}>Modes</a>
      </div>
      <form onSubmit={save} className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        <label>Name<input className="input" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></label>
        <label>Master URL<input className="input font-mono text-xs" value={f.masterUrl} onChange={(e) => setF({ ...f, masterUrl: e.target.value })} /></label>
        <label>Sidecar WS URL<input className="input font-mono text-xs" value={f.wsUrl} onChange={(e) => setF({ ...f, wsUrl: e.target.value })} /></label>
        <label>Health probe URL<input className="input font-mono text-xs" value={f.probeUrl} onChange={(e) => setF({ ...f, probeUrl: e.target.value })} /></label>
        <label>Protocol<select className="input" value={f.protocol} onChange={(e) => setF({ ...f, protocol: e.target.value })}><option>sidecar-v1</option><option>none</option></select></label>
        <label>Sidecar token {a.sidecarTokenHint && <span className="text-gray-500">(…{a.sidecarTokenHint})</span>}
          <input className="input" type="password" autoComplete="off" value={f.sidecarToken} placeholder="unchanged" onChange={(e) => setF({ ...f, sidecarToken: e.target.value })} /></label>
        <label className="self-end"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> enabled</label>
        <div className="self-end flex gap-2">
          <button className="btn" disabled={busy}>Save</button>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => confirm(`Delete app ${a.id}?`) && run(() => call(`/api/apps/${a.id}`, 'DELETE'), 'Deleted.')}>Delete</button>
        </div>
      </form>
      <div className="text-sm flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
        <span>API token: {a.apiTokenHint ? <code>…{a.apiTokenHint}</code> : 'none'} {a.apiScopes.length > 0 && <span className="text-gray-500">({a.apiScopes.join(', ')})</span>}</span>
        {SCOPES.map((s) => <label key={s}><input type="checkbox" checked={scopes.includes(s)} onChange={() => setScopes(scopes.includes(s) ? scopes.filter((x) => x !== s) : [...scopes, s])} /> {s}</label>)}
        <button className="btn-ghost" disabled={busy} onClick={() => run(async () => { const t = await call<{ token: string }>(`/api/apps/${a.id}/token`, 'POST', { scopes }); setNewToken(t.token); }, 'New token issued. Copy it now; it is not shown again.')}>{a.apiTokenHint ? 'Replace token' : 'Issue token'}</button>
        {a.apiTokenHint && <button className="btn-ghost" disabled={busy} onClick={() => run(() => call(`/api/apps/${a.id}/token`, 'DELETE'), 'Token revoked.')}>Revoke</button>}
      </div>
      {newToken && <pre className="text-xs bg-yellow-50 border border-yellow-200 rounded p-2 select-all break-all whitespace-pre-wrap">{newToken}</pre>}
      <Msg m={msg} />
    </div>
  );
}

export function AppRegistry({ apps }: { apps: AppView[] }) {
  const router = useRouter();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    try { await call('/api/apps', 'POST', { id, displayName: name }); setId(''); setName(''); setMsg({ ok: true, text: 'App added.' }); router.refresh(); }
    catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  }
  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card flex flex-wrap gap-2 items-end text-sm">
        <label>Id<input className="input font-mono" value={id} onChange={(e) => setId(e.target.value)} placeholder="my-app" /></label>
        <label>Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="My app" /></label>
        <button className="btn">Add app</button>
        <Msg m={msg} />
      </form>
      {apps.map((a) => <AppCard key={a.id} a={a} />)}
    </div>
  );
}
