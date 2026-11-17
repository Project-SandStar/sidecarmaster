'use client';
/** Settings > NetBird + HTTPS. Design ported from mcpfantom dashboard NetbirdPanel.tsx. */
import { useCallback, useEffect, useState } from 'react';
import type { NetbirdView } from '@/lib/netbird';

function Badge({ ok, text }: { ok: boolean | null; text: string }) {
  const c = ok === null ? 'bg-gray-100 text-gray-600' : ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${c}`}>{text}</span>;
}

function Switch({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 text-sm cursor-pointer">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="w-4 h-4" />
      {label}
    </label>
  );
}

export function NetbirdPanel() {
  const [d, setD] = useState<NetbirdView | null>(null);
  const [setupKey, setSetupKey] = useState('');
  const [hostname, setHostname] = useState('sidecarmaster');
  const [managementUrl, setManagementUrl] = useState('https://api.netbird.io:443');
  const [wireguardPort, setWireguardPort] = useState('0');
  const [externalIpMap, setExternalIpMap] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [httpsOn, setHttpsOn] = useState(false);
  const [domain, setDomain] = useState('netbird.cloud');
  const [cfToken, setCfToken] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((v: NetbirdView) => {
    setD(v); setHostname(v.hostname); setManagementUrl(v.managementUrl); setWireguardPort(String(v.wireguardPort)); setExternalIpMap(v.externalIpMap ?? '');
    setEnabled(v.enabled); setHttpsOn(v.https.enabled); setDomain(v.https.domain); setEmail(v.https.email);
  }, []);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const r = await fetch('/api/settings/netbird');
      if (r.ok && live) { const v = (await r.json()) as NetbirdView; setD(v); }
    };
    fetch('/api/settings/netbird').then(async (r) => { if (r.ok && live) apply((await r.json()) as NetbirdView); });
    const t = setInterval(load, 10_000);
    return () => { live = false; clearInterval(t); };
  }, [apply]);

  async function call(method: string, url: string, body?: unknown) {
    setBusy(true); setError(null); setSaved(false);
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    setBusy(false);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError((j as { error?: string }).error ?? `Error ${r.status}`); return; }
    apply(j as NetbirdView); setSetupKey(''); setCfToken(''); setSaved(true);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      hostname, managementUrl, wireguardPort: Number(wireguardPort), externalIpMap: externalIpMap.trim(), enabled,
      https: { enabled: httpsOn, domain, email, ...(cfToken ? { cloudflareToken: cfToken } : {}) },
    };
    if (setupKey) body.setupKey = setupKey;
    void call('PUT', '/api/settings/netbird', body);
  }

  const s = d?.status;
  const hs = d?.https.status;
  return (
    <form onSubmit={save} className="card space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">NetBird</h2>
        <div className="flex gap-2">
          {!d?.configured && <Badge ok={null} text="No NetBird container" />}
          {d?.configured && <Badge ok={s ? s.connected : null} text={s ? (s.connected ? 'Connected' : 'Not connected') : 'No status yet'} />}
        </div>
      </div>
      {s && (
        <p className="text-sm text-gray-600">
          {s.fqdn ?? '—'} · {s.ip ?? 'no IP'} · peers {s.peersConnected}/{s.peersTotal} · updated {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : '—'}
        </p>
      )}
      <div>
        <label className="block text-sm font-medium mb-1">Setup key</label>
        <input type="password" autoComplete="off" className="input" value={setupKey} onChange={(e) => setSetupKey(e.target.value)}
          placeholder={d?.hasKey ? 'Leave empty to keep the saved key' : 'Paste the setup key'} />
        <p className="text-xs text-gray-500 mt-1">{d?.hasKey ? `Key saved, ends in ${d.keyHint}` : 'No key saved'}. Make a reusable key in the NetBird admin, group &quot;servers&quot;.</p>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Hostname</label>
        <input className="input" value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="sidecarmaster" required />
        <p className="text-xs text-gray-500 mt-1">Peer name in NetBird. Gives {hostname || 'sidecarmaster'}.{domain || 'netbird.cloud'}.</p>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Management URL</label>
        <input type="url" className="input" value={managementUrl} onChange={(e) => setManagementUrl(e.target.value)} required />
      </div>
      <Switch on={enabled} set={setEnabled} label="Enable NetBird" />

      <div className="pt-4 border-t border-gray-200 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">HTTPS</h2>
          {d?.https.enabled && (
            <Badge ok={hs ? hs.running && !hs.error : null}
              text={!hs ? 'No status yet' : hs.error ? 'Error' : hs.certificate?.notAfter ? `Cert until ${new Date(hs.certificate.notAfter).toLocaleDateString()}` : hs.running ? 'Running, no cert yet' : 'Stopped'} />
          )}
        </div>
        <p className="text-sm text-gray-600">
          Serves this server as <b className="font-mono">https://{hostname || 'sidecarmaster'}.{domain || 'netbird.cloud'}</b> on the NetBird IP.
          The certificate comes from Let&apos;s Encrypt. Caddy proves the name with a Cloudflare DNS record.
        </p>
        {hs?.error && <p className="text-sm text-red-600">{hs.error}</p>}
        {hs?.certificate && hs.certificate.names.length > 0 && <p className="text-xs text-gray-500">Names: {hs.certificate.names.join(', ')}</p>}
        <Switch on={httpsOn} set={setHttpsOn} label="Enable HTTPS" />
        <div>
          <label className="block text-sm font-medium mb-1">Domain</label>
          <input className="input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="vpn.example.com" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Cloudflare API token</label>
          <input type="password" autoComplete="off" className="input" value={cfToken} onChange={(e) => setCfToken(e.target.value)}
            placeholder={d?.https.hasToken ? 'Leave empty to keep the saved token' : 'Paste the token'} />
          <p className="text-xs text-gray-500 mt-1">{d?.https.hasToken ? `Token saved, ends in ${d.https.tokenHint}` : 'No token saved'}.</p>
          <div className="mt-2 text-xs text-gray-600">
            <p className="mb-1">Make it in Cloudflare (My Profile → API Tokens → Create Token → &quot;Edit zone DNS&quot; template) with:</p>
            <table className="tbl">
              <tbody>
                <tr><td>Permissions</td><td><b>Zone → DNS → Edit</b> (makes the _acme-challenge TXT records)</td></tr>
                <tr><td>Permissions</td><td><b>Zone → Zone → Read</b> (finds the zone ID of example.com)</td></tr>
                <tr><td>Zone Resources</td><td><b>Include → Specific zone → example.com</b></td></tr>
                <tr><td>Client IP filter</td><td>Optional: allow only the office public IP</td></tr>
                <tr><td>TTL</td><td>Optional: an end date. You must then paste a new token here.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Email (optional)</label>
          <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Let's Encrypt account email" />
        </div>
      </div>

      <details className="pt-4 border-t border-gray-200">
        <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
        <div className="mt-3">
          <label className="block text-sm font-medium mb-1">WireGuard port</label>
          <input type="number" min={0} max={65535} className="input" value={wireguardPort} onChange={(e) => setWireguardPort(e.target.value)} />
          <p className="text-xs text-gray-500 mt-1">0 = NetBird picks a free port. Set a fixed port to forward it on the firewall (UDP) for direct peer-to-peer links.</p>
        </div>
        <div className="mt-3">
          <label className="block text-sm font-medium mb-1">Advertised public IP (optional)</label>
          <input className="input" value={externalIpMap} onChange={(e) => setExternalIpMap(e.target.value)} placeholder="99.92.186.153" />
          <p className="text-xs text-gray-500 mt-1">The public IP that forwards the WireGuard port (UDP) to this host. Peers then connect here directly instead of through the relay. Empty = not set. Passed as netbird up --external-ip-map.</p>
        </div>
      </details>

      {error && <p className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</p>}
      {saved && !error && <p className="p-3 bg-green-50 text-green-700 rounded-lg text-sm">Saved. The containers pick up the change in about 10 seconds.</p>}

      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" className="btn-ghost" disabled={!d?.https.hasToken || busy}
          onClick={() => confirm('Remove the Cloudflare token?') && call('DELETE', '/api/settings/netbird/token')}>Remove token</button>
        <button type="button" className="btn-ghost" disabled={!d?.hasKey || busy}
          onClick={() => confirm('Remove the setup key and turn NetBird off?') && call('DELETE', '/api/settings/netbird/key')}>Remove key</button>
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
