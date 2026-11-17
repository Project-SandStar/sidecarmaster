'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const RULES = ['', 'host-down', 'app-down', 'update-failed', 'disk-low', 'gpu-high'];

/** Mute a rule, a host or an app for some minutes (alerts still show; no email). */
export function MuteForm({ hosts, apps }: { hosts: { id: string; name: string }[]; apps: { id: string; name: string }[] }) {
  const router = useRouter();
  const [rule, setRule] = useState(''); const [hostId, setHostId] = useState(''); const [appId, setAppId] = useState('');
  const [minutes, setMinutes] = useState('60'); const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    const r = await fetch('/api/alerts/mutes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rule, hostId, appId, minutes: Number(minutes), reason }) });
    if (!r.ok) { setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Error ${r.status}`); return; }
    router.refresh();
  }
  return (
    <form onSubmit={add} className="flex gap-2 items-end flex-wrap text-sm">
      <label className="text-xs text-gray-600">Rule<select className="input mt-1" value={rule} onChange={(e) => setRule(e.target.value)}>{RULES.map((r) => <option key={r} value={r}>{r || 'any'}</option>)}</select></label>
      <label className="text-xs text-gray-600">Host<select className="input mt-1" value={hostId} onChange={(e) => setHostId(e.target.value)}><option value="">any</option>{hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
      <label className="text-xs text-gray-600">App<select className="input mt-1" value={appId} onChange={(e) => setAppId(e.target.value)}><option value="">any</option>{apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="text-xs text-gray-600">Minutes<input type="number" className="input mt-1 w-24" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
      <label className="text-xs text-gray-600">Reason<input className="input mt-1" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <button className="btn">Mute</button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </form>
  );
}
