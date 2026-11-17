'use client';
/** Host provisioning editor (port of Sound Suite admin-host-provisioning.tsx), keyed by hostId. */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call, Msg } from './api';

export interface HostProvView {
  hostId: string; name: string; os: string | null; hostOsOverride: string | null; reconcileEnabled: boolean; note: string | null;
  policyRev: number; pushedPolicyRev: number; lastConfigPushAt: string | null;
  apps: { appId: string; displayName: string; protocol: string; enabled: boolean; masterUrlOverride: string | null; wsPortOverride: number | null; defaultMaster: string | null }[];
}

const OS = ['', 'linux', 'mac-docker-ollama', 'windows-docker-wsl2'];

export function HostProvForm({ h }: { h: HostProvView }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); router.refresh(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  }
  const host = (b: Record<string, unknown>) => run(() => call(`/api/hosts/${h.hostId}`, 'PUT', b), 'Saved.');
  const app = (appId: string, b: Record<string, unknown>) => run(() => call(`/api/hosts/${h.hostId}/apps/${appId}`, 'PUT', b), 'Saved.');
  const synced = h.pushedPolicyRev >= h.policyRev;
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="font-semibold">{h.name}</div>
        <div className="text-xs text-gray-500">reported OS: <span className="pill bg-gray-100 text-gray-700">{h.os ?? 'unknown'}</span></div>
        <label className="text-sm">OS override{' '}
          <select className="input inline w-auto" disabled={busy} value={h.hostOsOverride ?? ''} onChange={(e) => host({ hostOsOverride: e.target.value || null })}>
            {OS.map((o) => <option key={o} value={o}>{o || 'auto'}</option>)}
          </select>
        </label>
        <label className="text-sm"><input type="checkbox" disabled={busy} checked={h.reconcileEnabled} onChange={(e) => host({ reconcileEnabled: e.target.checked })} /> reconcile</label>
        <span className={`pill ${synced ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`} title={h.lastConfigPushAt ? `Last push ${new Date(h.lastConfigPushAt).toLocaleString()}` : 'Never pushed'}>
          {synced ? 'in sync' : 'push pending'} · rev {h.policyRev}, pushed {h.pushedPolicyRev}
        </span>
        <button className="btn-ghost" disabled={busy} onClick={() => run(() => call(`/api/hosts/${h.hostId}/push`, 'POST'), 'Config pushed.')}>Push config now</button>
      </div>
      <table className="tbl">
        <thead><tr><th>App</th><th>On</th><th>Master URL override</th><th>WS port override</th><th>Default master</th></tr></thead>
        <tbody>
          {h.apps.map((a) => (
            <tr key={a.appId}>
              <td>{a.displayName}{a.protocol === 'none' && <div className="text-xs text-gray-500">no sidecar link</div>}</td>
              <td><input type="checkbox" disabled={busy} checked={a.enabled} onChange={(e) => app(a.appId, { enabled: e.target.checked })} /></td>
              <td><input className="input font-mono text-xs" disabled={busy} defaultValue={a.masterUrlOverride ?? ''} placeholder="(default)"
                onBlur={(e) => e.target.value !== (a.masterUrlOverride ?? '') && app(a.appId, { masterUrlOverride: e.target.value || null })} /></td>
              <td><input className="input w-24" type="number" disabled={busy} defaultValue={a.wsPortOverride ?? ''}
                onBlur={(e) => e.target.value !== String(a.wsPortOverride ?? '') && app(a.appId, { wsPortOverride: e.target.value ? Number(e.target.value) : null })} /></td>
              <td className="font-mono text-xs">{a.defaultMaster ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Msg m={msg} />
    </div>
  );
}
