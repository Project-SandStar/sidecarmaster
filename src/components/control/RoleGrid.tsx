'use client';
/**
 * Role assignments, Sound Suite layout (court-lens-mcp admin-role-assignments.tsx): one card per host,
 * a runtime grid (one radio per runtime, plus Off), a gear popover for per-host overrides,
 * loaded models and last heartbeat under each card.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { call, Msg } from './api';
import type { GridCell, GridColumn, HostOsInfo } from '@/lib/control/role-grid';
import { osLabel } from '@/lib/control/role-grid';

export interface RoleGridRow {
  appId: string; mode: string; label: string | null; description: string | null;
  enabled: boolean; runtime: string; cells: GridCell[]; unavailable: string | null;
  port: number | null; portShared: boolean; portTitle: string;
  minOnline: number; idleTimeoutMin: number; modelOverride: string | null; defaultModel: string | null; running: boolean;
}

export interface RoleHostCard {
  hostId: string; name: string; agentUrl: string | null; online: boolean; lastHeartbeatAt: string | null;
  os: HostOsInfo; gpu: string | null; loaded: { name: string; size: number | null }[];
  columns: GridColumn[]; rows: RoleGridRow[];
}

type Say = (m: { ok: boolean; text: string }) => void;

function fmtSize(b: number | null): string {
  if (!b || !Number.isFinite(b)) return '';
  const gb = b / 1024 ** 3;
  return gb >= 0.1 ? ` (${gb.toFixed(1)} GB)` : '';
}

function Overrides({ hostId, r, say, onClose }: { hostId: string; r: RoleGridRow; say: Say; onClose: () => void }) {
  const router = useRouter();
  const [model, setModel] = useState(r.modelOverride ?? '');
  const [minOnline, setMinOnline] = useState(String(r.minOnline));
  const [idle, setIdle] = useState(String(r.idleTimeoutMin));
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await call(`/api/hosts/${hostId}/roles`, 'PUT', {
        appId: r.appId, mode: r.mode, modelOverride: model.trim() || null, minOnline: Number(minOnline), idleTimeoutMin: Number(idle),
      });
      say({ ok: true, text: `Saved overrides for ${r.mode}.` });
      onClose();
      router.refresh();
    } catch (e) { say({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  }
  return (
    <div className="mt-1 mb-2 p-3 rounded-md border border-gray-200 bg-gray-50 space-y-2 text-xs">
      <div className="font-semibold text-gray-700">Per-host overrides for <span className="font-mono">{r.mode}</span></div>
      <label className="block">
        <span className="text-gray-500">Model override</span>
        <input className="input font-mono text-xs mt-0.5" disabled={busy} placeholder={r.defaultModel ?? 'default model'} value={model} onChange={(e) => setModel(e.target.value)} />
      </label>
      <div className="flex gap-3">
        <label className="block">
          <span className="text-gray-500">Min online</span>
          <input className="input w-20 mt-0.5" type="number" min={0} max={16} disabled={busy} value={minOnline} onChange={(e) => setMinOnline(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-gray-500">Idle minutes (0 = never stop)</span>
          <input className="input w-24 mt-0.5" type="number" min={0} disabled={busy} value={idle} onChange={(e) => setIdle(e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn !px-3 !py-1 !text-xs" disabled={busy} onClick={save}>Save</button>
        <button type="button" className="btn-ghost !px-3 !py-1 !text-xs" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function HostCard({ h, app, reconcileOff, now, say }: { h: RoleHostCard; app: string | null; reconcileOff: boolean; now: number; say: Say }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  // Optimistic selection per row: "<runtime>" or "off".
  // Picks belong to one server snapshot; a refresh (new `h`) drops them.
  const [picks, setPicks] = useState<{ src: RoleHostCard; v: Record<string, string> }>({ src: h, v: {} });
  const pick = picks.src === h ? picks.v : {};
  const setPick = (f: (p: Record<string, string>) => Record<string, string>) =>
    setPicks((s) => ({ src: h, v: f(s.src === h ? s.v : {}) }));

  async function choose(r: RoleGridRow, rt: string | null) {
    const k = `${r.appId}/${r.mode}`;
    setPick((p) => ({ ...p, [k]: rt ?? 'off' }));
    try {
      await call(`/api/hosts/${h.hostId}/roles`, 'PUT', rt ? { appId: r.appId, mode: r.mode, enabled: true, runtime: rt } : { appId: r.appId, mode: r.mode, enabled: false });
      say({ ok: true, text: `${h.name}: ${r.mode} ${rt ? `on ${r.cells.find((c) => c.key === rt)?.label ?? rt}` : 'off'}.${reconcileOff ? ' Saved only (reconcile is off).' : ''}` });
      router.refresh();
    } catch (e) {
      setPick((p) => { const n = { ...p }; delete n[k]; return n; });
      say({ ok: false, text: (e as Error).message });
    }
  }

  async function syncNow() {
    setBusy(true);
    try {
      const r = await call<{ ok: boolean; skipped?: string; error?: string }>(`/api/hosts/${h.hostId}/push`, 'POST');
      say(r.skipped === 'reconcile-off'
        ? { ok: true, text: `${h.name}: reconcile is off, so nothing was pushed. The saved roles reach the sidecar once reconcile is on.` }
        : { ok: r.ok, text: r.ok ? `${h.name}: config pushed.` : `${h.name}: push failed${r.error ? `: ${r.error}` : ''}.` });
    } catch (e) { say({ ok: false, text: `${h.name}: ${(e as Error).message}` }); }
    setBusy(false);
  }

  async function reset() {
    setConfirmReset(false);
    setBusy(true);
    try {
      const q = app ? `?app=${encodeURIComponent(app)}` : '';
      const r = await call<{ enabled: number; removed: number; pushed: boolean }>(`/api/hosts/${h.hostId}/roles/reset${q}`, 'POST');
      say({ ok: true, text: `${h.name}: reset to defaults (${r.enabled} on, ${r.removed} removed).${r.pushed ? '' : ' Saved only: reconcile is off, nothing was pushed.'}` });
      router.refresh();
    } catch (e) { say({ ok: false, text: `${h.name}: ${(e as Error).message}` }); }
    setBusy(false);
  }

  const last = h.lastHeartbeatAt ? Date.parse(h.lastHeartbeatAt) : null;
  const lastLabel = last ? `${Math.max(0, Math.floor((now - last) / 1000))} s ago` : 'never';
  const osOverridden = h.os.override && h.os.override !== h.os.os;

  return (
    <div className="bg-white shadow rounded-lg p-4" data-host={h.name}>
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${h.online ? 'bg-green-500' : 'bg-gray-300'}`} title={h.online ? 'online' : 'offline'} />
          <span className="text-sm font-semibold text-gray-900">{h.name}</span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200" title={`os=${h.os.os ?? 'unknown'} (${h.os.source ?? 'unknown'}). ${h.os.title}`} data-os={h.os.os ?? ''}>
            {osLabel(h.os.os)}
            {h.os.source === 'override' && <span className="text-amber-600"> (manual)</span>}
            {h.os.source === 'guessed' && <span className="text-gray-400"> (guessed)</span>}
          </span>
          {osOverridden && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200" title={h.os.title}>
              override: {osLabel(h.os.override)}
            </span>
          )}
          {h.gpu && <span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-800 border border-purple-200">{h.gpu}</span>}
          {h.agentUrl && <span className="text-[11px] text-gray-400 font-mono">{h.agentUrl}</span>}
        </div>
        <div className="flex gap-2 shrink-0">
          <button type="button" disabled={busy} onClick={syncNow}
            title={reconcileOff ? 'Reconcile is off: this does not push anything.' : 'Push the saved config to this sidecar now.'}
            className="px-2.5 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded-md border border-blue-200 disabled:opacity-50">
            Sync now
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirmReset(true)}
            title={reconcileOff ? 'Saves the per-OS defaults only. Nothing is pushed while reconcile is off.' : 'Restore per-OS defaults for this host.'}
            className="px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 rounded-md border border-gray-300 disabled:opacity-50">
            Reset to defaults
          </button>
        </div>
      </div>
      {confirmReset && (
        <div className="mb-3 p-3 rounded-md border border-amber-200 bg-amber-50 text-xs space-y-2">
          <div>
            Reset {h.name} to the {osLabel(h.os.os)} defaults{app ? ` for ${app}` : ' for every app'}? Every mode this OS can run turns on with its default runtime;
            model overrides are cleared; modes the OS cannot run are removed.
            {reconcileOff && <b> Reconcile is off: this only saves. Nothing is pushed and no container starts or stops.</b>}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn !px-3 !py-1 !text-xs" onClick={reset}>Reset</button>
            <button type="button" className="btn-ghost !px-3 !py-1 !text-xs" onClick={() => setConfirmReset(false)}>Cancel</button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="text-xs w-full border-separate" style={{ borderSpacing: 0 }}>
          <thead>
            <tr className="text-[11px] text-gray-500">
              <th className="text-left font-medium py-1 pr-3">Role</th>
              <th className="text-center font-medium py-1 px-2" title="Port the role binds under the selected runtime. ✱ marks a port shared by every role on that runtime.">Port</th>
              {h.columns.map((c) => (
                <th key={c.key} className={`text-center font-medium py-1 px-2 ${c.available ? '' : 'text-gray-300'}`} title={c.title}>{c.label}</th>
              ))}
              <th className="text-center font-medium py-1 px-2">Off</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {h.rows.map((r) => {
              const k = `${r.appId}/${r.mode}`;
              const p = pick[k];
              const enabled = p ? p !== 'off' : r.enabled;
              const selected = p && p !== 'off' ? p : r.runtime;
              const panelOpen = open === k;
              const note = r.unavailable ?? [r.label, r.description].filter(Boolean).join(' — ');
              return (
                <FragmentRow key={k}>
                  <tr className="border-t border-gray-100" data-role={k} data-selected={enabled ? selected : 'off'}>
                    <td className="py-1.5 pr-3">
                      <span className="font-mono text-gray-800">{r.mode}</span>
                      {note && <span className={`ml-1 cursor-help ${r.unavailable ? 'text-amber-500' : 'text-gray-400'}`} title={note}>ⓘ</span>}
                      {r.running && <span className="ml-1 text-[10px] text-green-700" title="Running on this host now">● running</span>}
                    </td>
                    <td className="text-center py-1.5 px-2">
                      {r.port == null ? <span className="text-gray-300">—</span> : (
                        <span className="font-mono text-gray-600 text-[11px]" title={r.portTitle}>
                          {r.port}{r.portShared && <span className="text-gray-400"> ✱</span>}
                        </span>
                      )}
                    </td>
                    {r.cells.map((c) => (
                      <td key={c.key} className="text-center py-1.5 px-2">
                        <input type="radio" name={`rt-${h.hostId}-${k}`} disabled={!c.available} checked={enabled && selected === c.key}
                          onChange={() => c.available && choose(r, c.key)} title={c.tooltip} aria-label={`${r.mode} ${c.label}`}
                          className={`accent-green-600 ${c.available ? 'cursor-pointer' : 'cursor-not-allowed opacity-30'}`} />
                      </td>
                    ))}
                    <td className="text-center py-1.5 px-2">
                      <input type="radio" name={`rt-${h.hostId}-${k}`} checked={!enabled} onChange={() => choose(r, null)}
                        title={`Disable ${r.mode} on this host`} aria-label={`${r.mode} off`} className="accent-gray-400 cursor-pointer" />
                    </td>
                    <td className="py-1.5 pl-2 text-right">
                      {enabled && (
                        <button type="button" onClick={() => setOpen(panelOpen ? null : k)} title="Per-host overrides (model, min online, idle minutes)"
                          className="text-gray-400 hover:text-gray-700 text-sm leading-none px-1">⚙</button>
                      )}
                    </td>
                  </tr>
                  {panelOpen && enabled && (
                    <tr><td colSpan={h.columns.length + 4}><Overrides hostId={h.hostId} r={r} say={say} onClose={() => setOpen(null)} /></td></tr>
                  )}
                </FragmentRow>
              );
            })}
          </tbody>
        </table>
      </div>
      {h.loaded.length > 0 && (
        <div className="mt-2 text-[11px] text-gray-600">
          <span className="text-gray-500">Currently loaded on {h.name}:</span>{' '}
          <span className="font-mono">{h.loaded.map((m, i) => <span key={m.name}>{i > 0 && ', '}{m.name}{fmtSize(m.size)}</span>)}</span>
        </div>
      )}
      <p className="text-[11px] text-gray-500 mt-2">Last synced {lastLabel}</p>
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }

export function RoleGrid({ hosts, app, reconcileOff }: { hosts: RoleHostCard[]; app: string | null; reconcileOff: boolean }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return (
    <div className="space-y-4">
      <Msg m={msg} />
      {hosts.map((h) => <HostCard key={h.hostId} h={h} app={app} reconcileOff={reconcileOff} now={now} say={setMsg} />)}
      {hosts.length === 0 && <p className="text-gray-500">No hosts yet.</p>}
    </div>
  );
}
