'use client';
/** Settings > Alerts: SMTP settings and "Send test email". The password is never sent back. */
import { useEffect, useState } from 'react';
import type { SmtpView, TlsMode } from '@/lib/alerts/smtp';

export function AlertsPanel() {
  const [d, setD] = useState<SmtpView | null>(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [tls, setTls] = useState<TlsMode>('starttls');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (v: SmtpView) => {
    setD(v); setHost(v.host); setPort(String(v.port)); setTls(v.tls); setUsername(v.username);
    setFrom(v.from); setTo(v.to.join(', ')); setEnabled(v.enabled);
  };
  useEffect(() => { fetch('/api/settings/alerts').then(async (r) => { if (r.ok) apply((await r.json()) as SmtpView); }); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const body: Record<string, unknown> = { host, port: Number(port), tls, username, from, to, enabled };
    if (password) body.password = password;
    const r = await fetch('/api/settings/alerts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setBusy(false);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg({ ok: false, text: (j as { error?: string }).error ?? `Error ${r.status}` }); return; }
    apply(j as SmtpView); setPassword(''); setMsg({ ok: true, text: 'Saved.' });
  }

  async function test() {
    setBusy(true); setMsg(null);
    const r = await fetch('/api/settings/alerts/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    setBusy(false);
    const j = (await r.json().catch(() => ({}))) as { error?: string; to?: string[] };
    setMsg(r.ok ? { ok: true, text: `Test email sent to ${(j.to ?? []).join(', ')}.` } : { ok: false, text: j.error ?? `Error ${r.status}` });
  }

  return (
    <form onSubmit={save} className="card space-y-4 max-w-2xl">
      <h2 className="text-lg font-semibold">Email alerts (SMTP)</h2>
      <p className="text-sm text-gray-600">Alerts (sidecar down, master down, update failed) go out by email. Save first, then send a test email.</p>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1">SMTP host</label>
          <input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.example.com" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Port</label>
          <input type="number" min={1} max={65535} className="input" value={port} onChange={(e) => setPort(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">TLS</label>
        <select className="input" value={tls} onChange={(e) => setTls(e.target.value as TlsMode)}>
          <option value="starttls">STARTTLS (port 587)</option>
          <option value="tls">TLS (port 465)</option>
          <option value="none">None (lab only)</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Username</label>
          <input className="input" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Password</label>
          <input type="password" autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder={d?.hasPassword ? 'Leave empty to keep it' : ''} />
          <p className="text-xs text-gray-500 mt-1">{d?.hasPassword ? `Saved, ends in ${d.passwordHint}` : 'No password saved'}</p>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">From</label>
        <input className="input" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="sidecarmaster <alerts@example.com>" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Send alerts to</label>
        <input className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="ops@example.com, me@example.com" />
        <p className="text-xs text-gray-500 mt-1">Separate addresses with commas.</p>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4" /> Send alert emails
      </label>
      {msg && <p className={`p-3 rounded-lg text-sm ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" className="btn-ghost" disabled={busy || !d?.host} onClick={test}>Send test email</button>
        <button className="btn" disabled={busy}>{busy ? 'Working…' : 'Save'}</button>
      </div>
    </form>
  );
}
