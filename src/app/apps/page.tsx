import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { StateBadge } from '@/components/StateBadge';
import { loadOverview } from '@/lib/dashboard';

export const dynamic = 'force-dynamic';

/** Apps: where each app runs. */
export default async function AppsPage() {
  const { hosts, apps, grid, alerts } = await loadOverview();
  return (
    <Shell title="Apps">
      <div className="card overflow-x-auto">
        <div className="h-sec">{apps.length} {apps.length === 1 ? 'app' : 'apps'} in the registry, {hosts.filter((h) => h.online).length} of {hosts.length} hosts online</div>
        <table className="tbl">
          <thead><tr><th>App</th><th>Master</th><th>Runs on</th><th>Open alerts</th></tr></thead>
          <tbody>
            {apps.map((a) => {
              const on = hosts.filter((h) => grid[h.hostId]?.[a.id]);
              const open = alerts.filter((x) => x.appId === a.id && x.state === 'open').length;
              return (
                <tr key={a.id}>
                  <td className="font-medium">
                    <Link className="text-blue-700" href={`/apps/${a.id}`}>{a.displayName}</Link>
                    {!a.enabled && <span className="pill bg-gray-100 text-gray-500 ml-2">off</span>}
                  </td>
                  <td className="font-mono text-xs">{a.masterUrl ?? '—'}</td>
                  <td>
                    {on.length
                      ? on.map((h) => (
                        <span key={h.hostId} className="inline-flex items-center gap-1 mr-3 whitespace-nowrap">
                          <Link className="text-blue-700" href={`/gpu/${h.hostId}`}>{h.name}</Link> <StateBadge state={grid[h.hostId][a.id].state} />
                        </span>
                      ))
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td>{open ? <Link href="/alerts" className="pill bg-red-100 text-red-800">{open} open</Link> : <span className="text-gray-400">—</span>}</td>
                </tr>
              );
            })}
            {apps.length === 0 && <tr><td colSpan={4} className="text-gray-500">No apps in the registry.</td></tr>}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
