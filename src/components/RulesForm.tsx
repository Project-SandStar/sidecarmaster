'use client';
/** Alert rule limits and the email cool-down. */
import { useEffect, useState } from 'react';
import type { RuleConfig } from '@/lib/alerts/rules';

const FIELDS: [keyof RuleConfig, string][] = [
  ['hostDownMin', 'Sidecar down after (min without heartbeat)'], ['hostCriticalMin', 'Critical after (min)'],
  ['appDownMin', 'App / master down after (min)'], ['gpuVramPct', 'GPU memory limit (%)'],
  ['gpuForMin', 'GPU over limit for (min)'], ['diskFreePct', 'Disk free below (%)'], ['cooldownMin', 'Email cool-down per alert (min)'],
];

export function RulesForm() {
  const [v, setV] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { fetch('/api/alerts/rules').then(async (r) => { if (r.ok) { const j = (await r.json()) as RuleConfig; setV(Object.fromEntries(Object.entries(j).map(([k, x]) => [k, String(x)]))); } }); }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    const r = await fetch('/api/alerts/rules', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)]))) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    setMsg(r.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: j.error ?? `Error ${r.status}` });
  }
  return (
    <form onSubmit={save} className="card space-y-3">
      <div className="font-medium">Rules</div>
      <div className="grid grid-cols-4 gap-3">
        {FIELDS.map(([k, label]) => (
          <label key={k} className="text-xs text-gray-600">{label}
            <input type="number" className="input mt-1" value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      {msg && <p className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</p>}
      <button className="btn">Save rules</button>
    </form>
  );
}
