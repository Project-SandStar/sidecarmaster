'use client';
/**
 * Hosts page: one card per host, Sound Suite "GPU Fleet" style.
 * Starts with server rows, then follows /api/fleet/live (SSE). All mapping and colours
 * come from src/lib/fleet/card.ts, so they are testable without a browser.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FleetRow } from '@/lib/fleet/view';
import type { RoleChip } from '@/lib/fleet/card';
import {
  fmtAgo, fmtIdle, fmtUntil, fmtUptime, gbOfBytes, gbOfMb, gpuBadge, gpuBarClass, gpuPct, hiddenRolesLabel, hostState,
  ROLE_STATE_DOT, ROLE_STATE_LEGEND, splitRoleChips, transportChip,
} from '@/lib/fleet/card';
import { ActionButton } from './ActionButton';

export interface HostCardsProps {
  initial: FleetRow[];
  initialNow: number;
  /** Reconcile off: nothing here may push config or start or stop containers. */
  reconcileOff: boolean;
  /** The relay can run host commands. */
  canAct: boolean;
  /** Show one host only (host page). */
  onlyHostId?: string;
}

const BORDER: Record<ReturnType<typeof hostState>['state'], string> = {
  live: 'border-l-green-500', http: 'border-l-yellow-400', offline: 'border-l-red-500', never: 'border-l-gray-300',
};
const CHIP_BOX: Record<RoleChip['state'], string> = {
  running: 'border-green-200 bg-green-50/50', starting: 'border-blue-200 bg-blue-50/50', created: 'border-slate-300 bg-slate-50', stopped: 'border-orange-200 bg-orange-50/50',
  missing: 'border-yellow-200 bg-yellow-50/50', unknown: 'border-gray-200 bg-gray-50',
};

export function HostCards({ initial, initialNow, reconcileOff, canAct, onlyHostId }: HostCardsProps) {
  const [rows, setRows] = useState(initial);
  const [now, setNow] = useState(initialNow);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/fleet/live');
    es.addEventListener('rows', (e) => { try { setRows(JSON.parse((e as MessageEvent).data)); setLive(true); } catch { /* ignore */ } });
    es.onerror = () => setLive(false);
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => { es.close(); clearInterval(t); };
  }, []);

  const shown = onlyHostId ? rows.filter((r) => r.hostId === onlyHostId) : rows;
  const liveN = rows.filter((r) => r.connected).length;
  const gpuN = rows.reduce((n, r) => n + r.gpus.length, 0);
  const roleT = rows.reduce((n, r) => n + r.roles.length, 0);
  const roleRun = rows.reduce((n, r) => n + r.roles.filter((c) => c.state === 'running').length, 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span className={`pill ${live ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`} title={live ? 'Rows update on every heartbeat.' : 'The live stream is not connected. Rows are from the last page load.'}>
          <span className={`dot ${live ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />{live ? 'live updates' : 'reconnecting…'}
        </span>
        {!onlyHostId && (
          <>
            <span><b className="text-gray-900">{liveN}</b> of {rows.length} hosts connected</span>
            <span><b className="text-gray-900">{gpuN}</b> {gpuN === 1 ? 'GPU' : 'GPUs'}</span>
            <span><b className="text-gray-900">{roleRun}</b> of {roleT} roles running</span>
          </>
        )}
        <RoleStateLegend />
      </div>
      {shown.map((r) => <HostCard key={r.hostId ?? r.agentUrl ?? r.name} r={r} now={now} reconcileOff={reconcileOff} canAct={canAct} showAllRoles={!!onlyHostId} />)}
      {shown.length === 0 && (
        <div className="card text-sm text-gray-500">No hosts yet. Hosts show up when a sidecar connects or the Sound Suite import runs.</div>
      )}
    </div>
  );
}

/** Role chip colours. */
export function RoleStateLegend() {
  return (
    <span className="flex flex-wrap items-center gap-1" data-legend="roles">
      <span>Roles:</span>
      {ROLE_STATE_LEGEND.map((l) => (
        <span key={l.state} className={`pill ${l.cls}`} title={l.title}><span className={`dot ${ROLE_STATE_DOT[l.state]}`} />{l.label}</span>
      ))}
    </span>
  );
}

export function HostCard({ r, now, reconcileOff, canAct, showAllRoles = false }: { r: FleetRow; now: number; reconcileOff: boolean; canAct: boolean; showAllRoles?: boolean }) {
  const [openHidden, setOpenHidden] = useState(false);
  const split = splitRoleChips(r.roles);
  const chips = showAllRoles || openHidden ? r.roles : split.shown;
  const st = hostState(r);
  const tc = transportChip(r.connected, r.transport);
  const running = r.roles.filter((c) => c.state === 'running').length;
  return (
    <section data-host={r.name} className={`card !p-0 overflow-hidden border-l-4 ${BORDER[st.state]}`}>
      {/* Header: status dot, name, version, transport, state, OS, GPU badges, heartbeat. */}
      <div className="px-4 py-3 flex flex-wrap items-center gap-2">
        <span className={`dot ${st.dot} ${st.state === 'live' ? 'animate-pulse' : ''}`} title={st.title} />
        {r.hostId
          ? <Link href={`/gpu/${r.hostId}`} className="font-semibold text-gray-900 hover:text-blue-700">{r.name}</Link>
          : <span className="font-semibold text-gray-900">{r.name}</span>}
        {r.hostname && r.hostname.toLowerCase() !== r.name.toLowerCase() && <span className="text-xs text-gray-400">{r.hostname}</span>}
        {r.version ? <span className="text-xs text-gray-400" title="Sidecar version">v{r.version}</span> : <span className="text-xs text-gray-300">no version</span>}
        <span className={`pill ${tc.cls}`} title={tc.title}>{tc.label}</span>
        <span className={`pill ${st.cls}`} title={st.title}>{st.label}</span>
        <span className="pill bg-gray-100 text-gray-700" title={r.os.title}>{r.os.label}{r.os.source === 'guessed' ? ' ?' : ''}</span>
        {r.gpus.map((g) => (
          <span key={g.index} className="pill bg-emerald-50 text-emerald-800 border border-emerald-200" title={`GPU ${g.index}: ${g.name}, ${gbOfMb(g.memoryTotal)} VRAM`}>{gpuBadge(g)}</span>
        ))}
        {!r.gpus.length && <span className="pill bg-gray-100 text-gray-400" title="The sidecar reports no GPU.">no GPU</span>}
        <span className="ml-auto text-xs text-gray-500 whitespace-nowrap" title={r.lastHeartbeatAt ? new Date(r.lastHeartbeatAt).toISOString() : 'No heartbeat yet'}>
          heartbeat <b className={st.state === 'live' ? 'text-gray-900' : st.state === 'offline' ? 'text-red-700' : 'text-gray-700'}>{fmtAgo(r.lastHeartbeatAt, now)}</b>
        </span>
      </div>

      {/* Facts line: URLs, mode, protocol, uptime, containers, source. */}
      <div className="px-4 pb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        {r.aliases.map((a) => (
          <span key={a} className={`font-mono ${a === r.agentUrl ? 'text-gray-800' : 'text-gray-400'}`} title={a === r.agentUrl ? 'Current sidecar URL' : 'Other URL of the same host'}>{a}</span>
        ))}
        {!r.aliases.length && <span className="font-mono text-gray-300">no URL</span>}
        <span>mode <b className="text-gray-700">{r.mode ?? '—'}</b></span>
        <span title="Sidecar protocol version">protocol <b className="text-gray-700">{r.protocolVersion ? `v${r.protocolVersion}` : '—'}</b></span>
        <span>uptime <b className="text-gray-700">{fmtUptime(r.uptime)}</b></span>
        <span>{r.containers ?? 0} {r.containers === 1 ? 'container' : 'containers'}, <b className="text-gray-700">{running} running</b></span>
        {typeof r.activeRequests === 'number' && r.activeRequests > 0 && <span><b className="text-gray-700">{r.activeRequests}</b> active requests</span>}
        {r.dockerMode && <span>docker <b className="text-gray-700">{r.dockerMode}</b></span>}
        {r.observedFromIp && <span>from <span className="font-mono">{r.observedFromIp}</span></span>}
        {r.source !== 'live' && <span className="text-gray-400">({r.source === 'saved' ? 'last saved state' : 'Sound Suite import only'})</span>}
      </div>

      {/* GPU bars. */}
      {r.gpus.length > 0 && (
        <div className="px-4 pb-2 space-y-1">
          {r.gpus.map((g) => {
            const pct = gpuPct(g);
            return (
              <div key={g.index} className="flex items-center gap-2 text-xs">
                <span className="w-48 truncate text-gray-700" title={g.name}>GPU {g.index}: {g.name}</span>
                <div className="flex-1 max-w-xs h-2 bg-gray-200 rounded-full overflow-hidden"><div className={`h-2 rounded-full ${gpuBarClass(pct)}`} style={{ width: `${pct}%` }} /></div>
                <span className="font-mono text-gray-600">{gbOfMb(g.memoryUsed)} / {gbOfMb(g.memoryTotal)} ({pct}%)</span>
                <span className="text-gray-400">{g.temperature}°C</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Roles. */}
      <div className="px-4 py-2 border-t border-gray-100">
        <div className="h-sec !mb-1">Roles</div>
        {r.roles.length
          ? (chips.length ? <div className="flex flex-wrap gap-2">{chips.map((c) => <RoleChipCard key={c.key} c={c} now={now} />)}</div> : null)
          : <div className="text-xs text-gray-400">No roles assigned and no containers reported.</div>}
        {!showAllRoles && split.hidden.length > 0 && (
          <button
            type="button" data-toggle="hidden-roles" onClick={() => setOpenHidden((v) => !v)}
            className="mt-1 text-xs text-gray-500 hover:text-blue-700 hover:underline"
            title={`Assigned, but no container on this host: ${split.hidden.map((c) => c.mode).join(', ')}`}
          >
            {hiddenRolesLabel(split.hidden.length, openHidden)}
          </button>
        )}
      </div>

      {/* Containers and errors. */}
      <div className="px-4 py-2 border-t border-gray-100 text-xs flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-gray-500">Containers:</span>
        {r.containerNames.length ? r.containerNames.map((n) => <span key={n} className="font-mono text-gray-700">{n}</span>) : <span className="text-gray-300">none reported</span>}
      </div>
      {r.errors.length > 0 && (
        <div className="px-4 py-2 border-t border-red-100 bg-red-50 text-xs text-red-800 space-y-0.5">
          {r.errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {/* Actions kept from the host page. Provision is off while reconcile is off. */}
      {r.hostId && (
        <div className="px-4 py-2 border-t border-gray-100 flex flex-wrap items-center gap-2 text-xs">
          <Link href={`/gpu/${r.hostId}`} className="text-blue-700 hover:underline">Details</Link>
          <Link href="/roleassign" className="text-blue-700 hover:underline">Role assignments</Link>
          {canAct ? (
            <>
              <ActionButton url={`/api/hosts/${r.hostId}/action`} body={{ action: 'update' }} label="Update sidecar" confirm={`Update the sidecar on ${r.name}?`} title="Tell the sidecar to update itself." />
              <ActionButton
                url={`/api/hosts/${r.hostId}/action`} body={{ action: 'provision' }} label="Provision" confirm={`Provision the role containers on ${r.name}?`}
                disabled={reconcileOff}
                title={reconcileOff ? 'Reconcile is off: provisioning would start containers, so it is disabled.' : 'Create the containers for the assigned roles.'}
              />
            </>
          ) : <span className="text-gray-400">Host commands need the relay.</span>}
        </div>
      )}
    </section>
  );
}

export function RoleChipCard({ c, now }: { c: RoleChip; now: number }) {
  return (
    <div data-role={c.key} className={`rounded-lg border p-2 text-xs w-72 max-w-full ${CHIP_BOX[c.state]}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-gray-900 truncate" title={c.appId ? `${c.appId} · ${c.mode}` : c.mode}>{c.mode}</span>
        <span className={`pill ${c.stateClass}`} title={c.status ? `Container status: ${c.status}` : 'No container reported'}>
          <span className={`dot ${ROLE_STATE_DOT[c.state]}`} />
          {c.stateLabel}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <span className={`pill-xs ${c.runtimeClass}`} title="Runtime">{c.runtime}</span>
        {c.port && <span className="font-mono text-gray-600" title="Port">:{c.port}</span>}
        {c.container && <span className="font-mono text-gray-400 truncate" title="Container name">{c.container}</span>}
        {!c.assigned && <span className="pill-xs bg-gray-100 text-gray-500 border-gray-200" title="The sidecar runs this, but there is no enabled assignment here.">unassigned</span>}
        {c.gpuOnly && c.gpuReady === false && <span className="pill-xs bg-red-50 text-red-700 border-red-200" title="GPU-only role, but the container has no GPU.">no GPU</span>}
      </div>
      <div className="mt-1 font-mono text-gray-700 truncate" title={c.model ?? ''}>{c.model ?? <span className="text-gray-300 italic">no model</span>}</div>
      {c.image && <div className="font-mono text-[10px] text-gray-400 truncate" title={c.image}>{c.image}</div>}
      {c.loaded.map((m) => (
        <div key={m.name} className="mt-1 flex flex-wrap items-center gap-x-2 text-gray-600">
          <span className="truncate max-w-[11rem]" title={m.name}>{m.name}</span>
          {typeof m.sizeBytes === 'number' && <span className="font-mono">{gbOfBytes(m.sizeBytes)}</span>}
          {typeof m.gpuPercent === 'number' && <span className={m.gpuPercent >= 100 ? 'text-green-700' : m.gpuPercent > 0 ? 'text-amber-700' : 'text-red-700'}>{m.gpuPercent}% GPU</span>}
          {m.until && fmtUntil(m.until, now) && <span className="text-gray-400" title={`Unloads at ${m.until}`}>until {fmtUntil(m.until, now)}</span>}
        </div>
      ))}
      <div className="mt-1 flex flex-wrap gap-x-3 text-gray-500">
        <span title="Idle timeout">idle {fmtIdle(c.idleTimeoutMs)}{c.idleTimerActive ? <span className="text-amber-700"> · timer running</span> : ''}</span>
        {typeof c.activeRequests === 'number' && c.activeRequests > 0 && <span><b className="text-gray-700">{c.activeRequests}</b> req</span>}
        {typeof c.vramMb === 'number' && c.vramMb > 0 && <span title="VRAM budget">{gbOfMb(c.vramMb)} VRAM</span>}
      </div>
      {c.error && <div className="mt-1 text-red-700">{c.error}</div>}
    </div>
  );
}
