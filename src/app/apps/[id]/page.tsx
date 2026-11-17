import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { AlertStateBadge, SeverityBadge, StateBadge, UpBadge } from '@/components/StateBadge';
import { ago } from '@/lib/fleet';
import { appErrors24h, loadOverview, containerState } from '@/lib/dashboard';
import { appForMode } from '@/lib/apps/interfaces';

export const dynamic = 'force-dynamic';

/** App page (SPEC §11.3): where it runs, instances, requests, master link from every host, errors 24 h. */
export default async function AppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { hosts, apps, grid } = await loadOverview();
  const app = apps.find((a) => a.id === id);
  if (!app) notFound();
  const errors = await appErrors24h(id);
  const health = errors.find((e) => e.rule === 'app-down' && !e.hostId && e.state !== 'closed');
  const kv = (k: string, v: React.ReactNode) => <div><div className="text-xs text-gray-500">{k}</div><div className="text-sm font-medium">{v ?? '—'}</div></div>;
  const on = hosts.filter((h) => grid[h.hostId]?.[id] || (h.masters ?? []).some((m) => m.appId === id));
  return (
    <Shell title={`App: ${app.displayName}`}>
      <div className="card grid grid-cols-2 md:grid-cols-4 gap-4">
        {kv('Health', app.protocol === 'none' ? 'No probe' : <UpBadge up={!health} />)}
        {kv('Master URL', <span className="font-mono text-xs">{app.masterUrl}</span>)}
        {kv('WS URL', <span className="font-mono text-xs">{app.wsUrl}</span>)}
        {kv('Modes', app.modes.join(', ') || null)}
      </div>
      <div className="card overflow-x-auto">
        <div className="h-sec">Instances</div>
        <table className="tbl">
          <thead><tr><th>Host</th><th>State</th><th>Containers</th><th>Active requests</th><th>Master link</th><th>Sidecar</th></tr></thead>
          <tbody>
            {on.map((h) => {
              const cs = (h.containers ?? []).filter((c) => (c.appId ?? appForMode(c.role ?? c.name, apps)) === id);
              const m = (h.masters ?? []).find((x) => x.appId === id);
              const cell = grid[h.hostId]?.[id];
              return (
                <tr key={h.hostId}>
                  <td><Link className="text-blue-700" href={`/gpu/${h.hostId}`}>{h.name}</Link></td>
                  <td>{cell ? <StateBadge state={cell.state} /> : '—'}</td>
                  <td>
                    {cs.map((c) => (
                      <div key={c.name} className="flex items-center gap-2 whitespace-nowrap">
                        <span className="font-mono text-xs">{c.role ?? c.name}</span> <StateBadge state={containerState(c.state)} />
                        {c.model ? <span className="text-xs text-gray-500 font-mono">{c.model}</span> : null}
                      </div>
                    ))}
                    {!cs.length && '—'}
                  </td>
                  <td>{cell?.activeRequests ?? 0}</td>
                  <td>{m ? (m.connected ? <span className="pill bg-green-100 text-green-800">connected</span> : <span className="pill bg-red-100 text-red-800">{m.lastError ?? 'not connected'}</span>) : '—'}</td>
                  <td className="text-xs">{h.sidecarVersion ? `v${h.sidecarVersion}` : '—'} <span className="text-gray-500">· {ago(h.lastHeartbeatAt)}</span></td>
                </tr>
              );
            })}
            {!on.length && <tr><td colSpan={6} className="text-gray-500">Not running on any host.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card">
        <div className="h-sec">Errors in the last 24 h</div>
        <ul className="text-sm space-y-1">
          {errors.map((e) => <li key={e.id}><SeverityBadge severity={e.severity} /> <AlertStateBadge state={e.state} muted={e.muted} /> <span className="ml-1">{e.message}</span> <span className="text-gray-500">({ago(e.openedAt)})</span></li>)}
          {!errors.length && <li className="text-gray-500">None.</li>}
        </ul>
      </div>
    </Shell>
  );
}
