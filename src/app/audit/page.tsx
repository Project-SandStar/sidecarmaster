import { Shell } from '@/components/Shell';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Colour by what the action did: red for deletes and revokes, amber for host commands and pushes, grey otherwise. */
function actionClass(action: string): string {
  if (/delete|revoke|remove/.test(action)) return 'bg-red-50 text-red-800 border-red-200';
  if (/^host\.|push|rollout|reset/.test(action)) return 'bg-amber-50 text-amber-800 border-amber-200';
  if (/login|logout|auth/.test(action)) return 'bg-blue-50 text-blue-800 border-blue-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
}

export default async function AuditPage() {
  const rows = await prisma.auditLog.findMany({ orderBy: { at: 'desc' }, take: 200 });
  return (
    <Shell title="Audit log">
      <div className="card overflow-x-auto">
        <div className="h-sec">Newest {rows.length} entries (UTC)</div>
        <table className="tbl">
          <thead><tr><th>Time</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap font-mono text-xs">{r.at.toISOString().replace('T', ' ').slice(0, 19)}</td>
                <td className="whitespace-nowrap">{r.actor}</td>
                <td><span className={`pill-xs font-mono ${actionClass(r.action)}`}>{r.action}</span></td>
                <td className="font-mono text-xs break-all text-gray-600">{r.detail ?? ''}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="text-gray-500">Nothing logged yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
