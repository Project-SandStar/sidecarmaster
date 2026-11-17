import { Shell } from '@/components/Shell';
import { ActionButton } from '@/components/ActionButton';
import { AddReleaseForm, GithubSyncForm, GitlabImportForm, RolloutControl } from '@/components/ReleaseForms';
import { prisma } from '@/lib/db';
import { listReleases, compareVersions } from '@/lib/releases';
import { getFleetStatus } from '@/lib/fleet/interfaces';
import { PRODUCTS } from '@/lib/updates';

export const dynamic = 'force-dynamic';

const CHANNEL_CLASS: Record<string, string> = { stable: 'bg-green-100 text-green-800', beta: 'bg-amber-100 text-amber-800' };
const ROLLOUT_CLASS: Record<string, string> = { all: 'bg-green-100 text-green-800', hosts: 'bg-blue-100 text-blue-800', none: 'bg-gray-100 text-gray-500' };

/** Releases + update feed: add, import from GitLab, roll out, per-host versions. */
export default async function ReleasesPage() {
  const [releases, hostRows, live] = await Promise.all([
    listReleases(), prisma.host.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }), (await getFleetStatus()).list(),
  ]);
  const newest = (product: string) => releases.filter((r) => r.product === product && r.channel === 'stable' && r.rollout === 'all')
    .sort((a, b) => compareVersions(b.version, a.version))[0]?.version ?? null;
  const name = (id: string) => hostRows.find((h) => h.id === id)?.name ?? id;
  return (
    <Shell title="Releases">
      <p className="text-sm text-gray-600">Feed: <span className="font-mono">GET /api/updates/&lt;product&gt;/&lt;platform&gt;?channel=stable</span>. Sidecars add <span className="font-mono">&amp;host=&lt;name&gt;</span> to get per-host rollouts.</p>
      <div className="card overflow-x-auto">
        <div className="h-sec">Builds: {releases.length}</div>
        <table className="tbl">
          <thead><tr><th>Product</th><th>Platform</th><th>Channel</th><th>Version</th><th>Build</th><th>SHA-256</th><th>Source</th><th>Rollout</th><th></th></tr></thead>
          <tbody>
            {releases.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.product}</td>
                <td className="font-mono text-xs">{r.platform}</td>
                <td><span className={`pill ${CHANNEL_CLASS[r.channel] ?? 'bg-gray-100 text-gray-600'}`}>{r.channel}</span></td>
                <td className="font-mono">{r.version}</td>
                <td className="font-mono text-xs">{r.build}</td>
                <td className="font-mono text-xs" title={r.sha256}>{r.sha256.slice(0, 12)}…</td>
                <td className="text-xs">{r.source}{r.gitlabTag ? ` ${r.gitlabTag}` : ''}<br /><a className="text-blue-700" href={r.url}>download</a></td>
                <td>
                  <div className="mb-1">
                    <span className={`pill ${ROLLOUT_CLASS[r.rollout] ?? 'bg-gray-100 text-gray-600'}`}>{r.rollout}</span>
                    {r.rollout === 'hosts' && <span className="text-xs text-gray-500 ml-1">{r.hosts.map((h) => name(h.hostId)).join(', ')}</span>}
                  </div>
                  <RolloutControl id={r.id} rollout={r.rollout} hostIds={r.hosts.map((h) => h.hostId)} hosts={hostRows} />
                </td>
                <td><ActionButton method="DELETE" url={`/api/releases/${r.id}`} label="Delete" confirm={`Delete ${r.product} ${r.platform} build ${r.build}?`} /></td>
              </tr>
            ))}
            {!releases.length && <tr><td colSpan={9} className="text-gray-500">No releases yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card overflow-x-auto">
        <div className="h-sec">Versions per host</div>
        <table className="tbl">
          <thead><tr><th>Host</th>{PRODUCTS.map((p) => <th key={p}>{p} <span className="normal-case font-normal">(newest stable: {newest(p) ?? '—'})</span></th>)}</tr></thead>
          <tbody>
            {live.map((h) => (
              <tr key={h.hostId}>
                <td className="font-medium">{h.name}</td>
                {PRODUCTS.map((p) => {
                  const v = h.versions?.[p] ?? (p === 'docker-sidecar' ? h.sidecarVersion : null);
                  const n = newest(p);
                  const old = v && n && compareVersions(v, n) < 0;
                  const updating = h.update?.product === p && h.update.state !== 'ok';
                  return (
                    <td key={p} className="font-mono text-xs">
                      {v ?? '—'}
                      {old ? <span className="pill bg-amber-100 text-amber-800 ml-2 font-sans">behind</span> : v && n ? <span className="pill bg-green-100 text-green-800 ml-2 font-sans">current</span> : null}
                      {updating ? <span className={`pill ml-2 font-sans ${h.update?.state === 'failed' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>{h.update?.state}</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!live.length && <tr><td colSpan={1 + PRODUCTS.length} className="text-gray-500">No hosts.</td></tr>}
          </tbody>
        </table>
      </div>
      <AddReleaseForm />
      <GithubSyncForm />
      <GitlabImportForm />
    </Shell>
  );
}
