import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { Sparkline } from '@/components/Sparkline';
import { HostCards } from '@/components/HostCards';
import { ReconcileBanner } from '@/components/ReconcileBanner';
import { AlertStateBadge, SeverityBadge } from '@/components/StateBadge';
import { prisma } from '@/lib/db';
import { ago, fleetRows } from '@/lib/fleet';
import { getFleetControl, getFleetStatus } from '@/lib/fleet/interfaces';
import { reconcileSwitch } from '@/lib/control/reconcile-switch';
import { hostSeries } from '@/lib/monitor/samples';

export const dynamic = 'force-dynamic';

/** Host page (SPEC §11.2): the live host card, then the facts the card does not show. */
export default async function HostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fleet = await getFleetStatus();
  const [h, row, rows, series, alerts] = await Promise.all([
    fleet.get(id), prisma.host.findUnique({ where: { id }, include: { roles: true, apps: true } }), fleetRows(),
    hostSeries(id), prisma.alert.findMany({ where: { hostId: id }, orderBy: { openedAt: 'desc' }, take: 20 }),
  ]);
  if (!h && !row) notFound();
  const name = h?.name ?? row!.name;
  const sw = await reconcileSwitch();
  const off = !sw.on;
  const kv = (k: string, v: React.ReactNode) => <div><div className="text-xs text-gray-500">{k}</div><div className="text-sm font-medium">{v ?? '—'}</div></div>;
  return (
    <Shell title={`Host: ${name}`}>
      {off && <ReconcileBanner reason={sw.reason} />}
      {/* eslint-disable-next-line react-hooks/purity -- server render time for "ago" labels */}
      <HostCards initial={rows.filter((r) => r.hostId === id)} initialNow={Date.now()} reconcileOff={off} canAct={!!getFleetControl()} onlyHostId={id} />

      <div className="card grid grid-cols-2 md:grid-cols-4 gap-4">
        {kv('NetBird IP', h?.netbirdIp ?? row?.netbirdIp)}
        {kv('Last seen from', row?.lastSeenFromIp ? <span className="font-mono text-xs">{row.lastSeenFromIp}</span> : null)}
        {kv('Versions', Object.entries(h?.versions ?? {}).map(([p, v]) => `${p} ${v}`).join(', ') || h?.sidecarVersion)}
        {kv('Disk free', typeof h?.diskFreePct === 'number' ? `${h.diskFreePct.toFixed(0)} %` : null)}
        {kv('Update', h?.update ? `${h.update.product} ${h.update.state}${h.update.error ? `: ${h.update.error}` : ''}` : null)}
        {kv('Source', row?.source)}
        {kv('Joined', row?.joinedAt ? ago(row.joinedAt) : null)}
        {kv('Note', row?.note)}
      </div>

      <p className="text-xs text-gray-500">
        Host commands: <b>Update sidecar</b> and <b>Provision</b> are on the card. <span className="font-mono">restart-sidecar</span>, <span className="font-mono">freeze</span> and <span className="font-mono">unfreeze</span> are not supported by the sidecar yet.
      </p>

      <div className="card grid grid-cols-2 gap-6">
        <Sparkline label="Active requests (24 h)" values={series.map((s) => s.activeRequests)} />
        <Sparkline label="GPU memory used (24 h)" unit=" %" max={100} values={series.map((s) => (s.vramTotalMb && s.vramUsedMb !== null ? (s.vramUsedMb / s.vramTotalMb) * 100 : null))} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card overflow-x-auto">
          <div className="h-sec">Masters</div>
          <table className="tbl">
            <thead><tr><th>App</th><th>URL</th><th>Link</th></tr></thead>
            <tbody>
              {(h?.masters ?? []).map((m) => (
                <tr key={m.url}>
                  <td>{m.appId ?? '—'}</td><td className="font-mono text-xs">{m.url}</td>
                  <td>{m.connected ? <span className="pill bg-green-100 text-green-800">connected</span> : <span className="pill bg-red-100 text-red-800">{m.lastError ?? 'not connected'}</span>}</td>
                </tr>
              ))}
              {!(h?.masters ?? []).length && <tr><td colSpan={3} className="text-gray-500">No master data.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card overflow-x-auto">
          <div className="h-sec">Roles assigned</div>
          <table className="tbl">
            <thead><tr><th>App</th><th>Mode</th><th>Runtime</th><th>Idle</th><th>Enabled</th></tr></thead>
            <tbody>
              {(row?.roles ?? []).map((r) => (
                <tr key={r.id}>
                  <td><Link className="text-blue-700" href={`/apps/${r.appId}`}>{r.appId}</Link></td>
                  <td className="font-mono text-xs">{r.mode}</td>
                  <td className="text-xs">{r.runtime ?? <span className="text-gray-400">default</span>}</td>
                  <td className="text-xs">{r.idleTimeoutMin ? `${r.idleTimeoutMin} min` : 'never'}</td>
                  <td>{r.enabled ? <span className="pill bg-green-100 text-green-800">on</span> : <span className="pill bg-gray-100 text-gray-500">off</span>}</td>
                </tr>
              ))}
              {!(row?.roles ?? []).length && <tr><td colSpan={5} className="text-gray-500">None.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="h-sec">Errors and alerts</div>
        <ul className="text-sm space-y-1">
          {(h?.errors ?? []).map((e, i) => <li key={`e${i}`} className="text-red-700">{e}</li>)}
          {alerts.map((a) => <li key={a.id}><SeverityBadge severity={a.severity} /> <AlertStateBadge state={a.state} muted={a.muted} /> <span className="ml-1">{a.message}</span> <span className="text-gray-500">({ago(a.openedAt)})</span></li>)}
          {!alerts.length && !(h?.errors ?? []).length && <li className="text-gray-500">None.</li>}
        </ul>
      </div>
    </Shell>
  );
}
