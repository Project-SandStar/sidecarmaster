import { Shell } from '@/components/Shell';
import { ActionButton } from '@/components/ActionButton';
import { MuteForm } from '@/components/MuteForm';
import { RulesForm } from '@/components/RulesForm';
import { AlertStateBadge, SeverityBadge } from '@/components/StateBadge';
import { prisma } from '@/lib/db';
import { ago } from '@/lib/fleet';

export const dynamic = 'force-dynamic';

/** Alerts: list, ack, close, mute (SPEC §11.5). */
export default async function AlertsPage() {
  const now = new Date();
  const [active, closed, mutes, hosts, apps] = await Promise.all([
    prisma.alert.findMany({ where: { state: { in: ['open', 'ack'] } }, orderBy: { openedAt: 'desc' } }),
    prisma.alert.findMany({ where: { state: 'closed' }, orderBy: { closedAt: 'desc' }, take: 50 }),
    prisma.alertMute.findMany({ where: { until: { gt: now } }, orderBy: { until: 'asc' } }),
    prisma.host.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.app.findMany({ select: { id: true, displayName: true }, orderBy: { id: 'asc' } }),
  ]);
  const hostName = (id: string | null) => hosts.find((h) => h.id === id)?.name ?? id ?? '—';
  const open = active.filter((a) => a.state === 'open' && !a.muted).length;
  return (
    <Shell title="Alerts">
      <div className="card overflow-x-auto">
        <div className="h-sec">Active: {active.length}{open ? `, ${open} open and not muted` : ''}</div>
        <table className="tbl">
          <thead><tr><th>Severity</th><th>State</th><th>Rule</th><th>Where</th><th>Message</th><th>Opened</th><th></th></tr></thead>
          <tbody>
            {active.map((a) => (
              <tr key={a.id}>
                <td><SeverityBadge severity={a.severity} /></td>
                <td><AlertStateBadge state={a.state} muted={a.muted} />{a.ackedBy ? <div className="text-xs text-gray-500">by {a.ackedBy}</div> : null}</td>
                <td className="font-mono text-xs">{a.rule}</td>
                <td className="text-xs">{a.hostId ? hostName(a.hostId) : ''}{a.hostId && a.appId ? ' · ' : ''}{a.appId ?? ''}{!a.hostId && !a.appId ? '—' : ''}</td>
                <td>{a.message}</td>
                <td className="whitespace-nowrap text-xs">{ago(a.openedAt)}</td>
                <td className="whitespace-nowrap space-x-2">
                  {a.state === 'open' && <ActionButton url={`/api/alerts/${a.id}`} body={{ action: 'ack' }} label="Ack" />}
                  <ActionButton url={`/api/alerts/${a.id}`} body={{ action: a.muted ? 'unmute' : 'mute' }} label={a.muted ? 'Unmute' : 'Mute'} />
                  <ActionButton url={`/api/alerts/${a.id}`} body={{ action: 'close' }} label="Close" />
                </td>
              </tr>
            ))}
            {!active.length && <tr><td colSpan={7} className="text-gray-500">No active alerts.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card space-y-3 overflow-x-auto">
        <div className="h-sec">Mutes</div>
        <MuteForm hosts={hosts} apps={apps.map((a) => ({ id: a.id, name: a.displayName }))} />
        <table className="tbl">
          <thead><tr><th>Rule</th><th>Host</th><th>App</th><th>Until (UTC)</th><th>Reason</th><th></th></tr></thead>
          <tbody>
            {mutes.map((m) => (
              <tr key={m.id}>
                <td className="font-mono text-xs">{m.rule ?? <span className="font-sans text-gray-500">any rule</span>}</td>
                <td>{m.hostId ? hostName(m.hostId) : <span className="text-gray-500">any host</span>}</td>
                <td>{m.appId ?? <span className="text-gray-500">any app</span>}</td>
                <td className="whitespace-nowrap text-xs">{m.until.toISOString().slice(0, 16).replace('T', ' ')}</td>
                <td className="text-xs">{m.reason ?? ''}</td>
                <td><ActionButton method="DELETE" url={`/api/alerts/mutes?id=${m.id}`} label="Remove" /></td>
              </tr>
            ))}
            {!mutes.length && <tr><td colSpan={6} className="text-gray-500">No mutes.</td></tr>}
          </tbody>
        </table>
      </div>
      <RulesForm />
      <div className="card overflow-x-auto">
        <div className="h-sec">Recently closed</div>
        <table className="tbl">
          <thead><tr><th>Severity</th><th>Rule</th><th>Message</th><th>Opened</th><th>Closed</th></tr></thead>
          <tbody>
            {closed.map((a) => (
              <tr key={a.id}>
                <td><SeverityBadge severity={a.severity} /></td>
                <td className="font-mono text-xs">{a.rule}</td>
                <td>{a.message}</td>
                <td className="whitespace-nowrap text-xs">{ago(a.openedAt)}</td>
                <td className="whitespace-nowrap text-xs">{ago(a.closedAt)}</td>
              </tr>
            ))}
            {!closed.length && <tr><td colSpan={5} className="text-gray-500">None.</td></tr>}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
