import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { SeverityBadge, StateBadge, UpBadge } from '@/components/StateBadge';
import { ago, lastImport } from '@/lib/fleet';
import { loadOverview } from '@/lib/dashboard';
import { netbirdStore } from '@/lib/netbird';
import { smtpView } from '@/lib/alerts/smtp';

export const dynamic = 'force-dynamic';

/** Dashboard: hosts × apps grid, hosts up/down, open alerts. */
export default async function Home() {
  const [{ hosts, apps, grid, alerts }, imp, smtp] = await Promise.all([loadOverview(), lastImport(), smtpView()]);
  const nb = netbirdStore().view();
  const up = hosts.filter((h) => h.online).length;
  const shownApps = apps.filter((a) => a.enabled && hosts.some((h) => grid[h.hostId]?.[a.id]));
  const openAlerts = alerts.filter((a) => a.state === 'open' && !a.muted);
  const card = (label: string, value: React.ReactNode, warn = false) => (
    <div className="card"><div className="text-sm text-gray-500">{label}</div><div className={`text-xl font-semibold mt-1 ${warn ? 'text-red-700' : ''}`}>{value}</div></div>
  );
  return (
    <Shell title="Overview">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {card('Hosts up', <Link href="/gpu">{up} / {hosts.length}</Link>, up < hosts.length)}
        {card('Open alerts', <Link href="/alerts">{openAlerts.length}</Link>, openAlerts.length > 0)}
        {card('NetBird', !nb.configured ? 'No container' : !nb.enabled ? 'Off' : nb.status?.connected ? `Connected ${nb.status.ip}` : 'Not connected')}
        {card('Email alerts', smtp.enabled ? 'On' : 'Off')}
      </div>
      {openAlerts.length > 0 && (
        <div className="card text-sm">
          <div className="h-sec">Open alerts</div>
          <ul className="space-y-1">
            {openAlerts.slice(0, 8).map((a) => (
              <li key={a.id}><SeverityBadge severity={a.severity} /> <span className="ml-1">{a.message}</span> <span className="text-gray-500">({ago(a.openedAt)})</span></li>
            ))}
          </ul>
        </div>
      )}
      <div className="card overflow-x-auto">
        <div className="h-sec">Hosts × apps</div>
        <table className="tbl">
          <thead><tr><th>Host</th><th>Sidecar</th><th>Last heartbeat</th>{shownApps.map((a) => <th key={a.id}><Link href={`/apps/${a.id}`}>{a.displayName}</Link></th>)}</tr></thead>
          <tbody>
            {hosts.map((h) => (
              <tr key={h.hostId}>
                <td className="font-medium"><Link className="text-blue-700" href={`/gpu/${h.hostId}`}>{h.name}</Link></td>
                <td className="whitespace-nowrap"><UpBadge up={h.online} /> <span className="text-xs text-gray-500">{h.sidecarVersion ? `v${h.sidecarVersion}` : ''}</span></td>
                <td className="whitespace-nowrap text-xs">{ago(h.lastHeartbeatAt)}</td>
                {shownApps.map((a) => {
                  const c = grid[h.hostId]?.[a.id];
                  return (
                    <td key={a.id}>
                      {c ? <><StateBadge state={c.state} /><div className="text-xs text-gray-500 mt-1">{c.roles.join(', ')}{c.activeRequests ? ` · ${c.activeRequests} req` : ''}</div></> : <span className="text-gray-300">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            {hosts.length === 0 && <tr><td colSpan={3 + shownApps.length} className="text-gray-500">No hosts yet. The import runs every few minutes.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card text-sm">
        <span className="font-medium">Last Sound Suite import: </span>
        {imp ? <>{ago(imp.at)} from <span className="font-mono">{imp.source}</span></> : 'Never'}
      </div>
    </Shell>
  );
}
