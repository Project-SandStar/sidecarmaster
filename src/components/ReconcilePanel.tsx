'use client';
/**
 * Settings > Reconcile: the on/off switch, last run, and a dry-run preview of what turning it on WOULD do.
 * Turning it on needs a fresh preview and a confirm dialog that names every container it would stop.
 */
import { useCallback, useEffect, useState } from 'react';
import type { FleetPlan, PlanAction } from '@/lib/control/reconcile-plan';
import type { LastPreview, LastRun } from '@/lib/control/reconcile-switch';

interface View {
  on: boolean; setting: boolean; lockedByEnv: boolean; reason: string | null; lockText: string | null;
  lastRun: LastRun | null; lastPreview: LastPreview | null; previewMaxAgeMs: number;
}
type Preview = FleetPlan & { id: string; stopList: string[] };

const ACTION_STYLE: Record<PlanAction, string> = {
  stop: 'bg-red-100 text-red-800 border-red-200',
  start: 'bg-green-100 text-green-800 border-green-200',
  reconfigure: 'bg-amber-100 text-amber-800 border-amber-200',
  'gave-up': 'bg-gray-200 text-gray-700 border-gray-300',
  keep: 'bg-gray-50 text-gray-600 border-gray-200',
  'on-demand': 'bg-blue-50 text-blue-700 border-blue-200',
  leave: 'bg-gray-50 text-gray-400 border-gray-200',
};
const ACTION_LABEL: Record<PlanAction, string> = {
  stop: 'stop', start: 'start', reconfigure: 'reconfigure', 'gave-up': 'gave up', keep: 'keep', 'on-demand': 'on demand', leave: 'leave',
};

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : 'never');

function lastRunText(r: LastRun | null): string {
  if (!r) return 'No run yet.';
  if (r.error) return `Error: ${r.error}`;
  if (r.skipped) return `Skipped (${r.skipped}).`;
  return `${r.hosts} hosts checked, ${r.fixes} fixes (${r.done} done, ${r.failed} failed, ${r.gaveUp} gave up), min-online started ${r.minOnlineStarted}.`;
}

export function ReconcilePanel() {
  const [v, setV] = useState<View | null>(null);
  const [plan, setPlan] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/settings/reconcile');
    if (r.ok) setV((await r.json()) as View);
  }, []);
  useEffect(() => {
    fetch('/api/settings/reconcile').then(async (r) => { if (r.ok) setV((await r.json()) as View); });
  }, []);

  async function preview(): Promise<Preview | null> {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/settings/reconcile/preview', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ ok: false, text: (j as { error?: string }).error ?? `Error ${r.status}` }); return null; }
      setPlan(j as Preview);
      await load();
      return j as Preview;
    } finally { setBusy(false); }
  }

  async function setEnabled(enabled: boolean) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/settings/reconcile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, ...(enabled && plan ? { previewId: plan.id } : {}) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ ok: false, text: (j as { error?: string }).error ?? `Error ${r.status}` }); return; }
      setV(j as View);
      setMsg({ ok: true, text: enabled ? 'Reconcile is on. The loop acts on its next tick (within 30 s).' : 'Reconcile is off. Nothing is pushed, started or stopped.' });
    } finally { setBusy(false); setConfirm(false); }
  }

  /** Turning on: always run a fresh preview, then show the confirm dialog. */
  async function askTurnOn() {
    const p = await preview();
    if (p) setConfirm(true);
  }

  if (!v) return <div className="card text-sm text-gray-500">Loading…</div>;

  return (
    <div className="space-y-4" id="reconcile">
      <div className="card space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-semibold">Reconcile</div>
            <p className="text-sm text-gray-600 max-w-2xl">
              When on, every 30 s sidecarmaster makes each host match its saved role assignments: it pushes the config,
              starts assigned roles and stops roles that are not assigned. When off, nothing is pushed, started or stopped.
            </p>
          </div>
          <span data-reconcile-state={v.on ? 'on' : 'off'}
            className={`shrink-0 text-xs font-semibold px-2 py-1 rounded border ${v.on ? 'bg-green-100 text-green-800 border-green-200' : 'bg-amber-50 text-amber-900 border-amber-200'}`}>
            {v.on ? 'ON' : 'OFF'}
          </span>
        </div>

        {v.lockedByEnv && (
          <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-lock="env">
            <b>Locked off by SM_RECONCILE=0 in sidecarmaster.env.</b> The switch below cannot turn reconcile on until that line is removed and the app restarts.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {v.on ? (
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setEnabled(false)}>Turn off</button>
          ) : (
            <button type="button" className="btn" disabled={busy || v.lockedByEnv} onClick={askTurnOn}
              title={v.lockedByEnv ? v.lockText ?? '' : 'Runs a preview first, then asks you to confirm.'}>
              Turn on…
            </button>
          )}
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => preview()}>Preview</button>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => preview()}
            title="Same preview, at any time. Sends nothing to the hosts.">Run once (dry run)</button>
          {busy && <span className="text-xs text-gray-500">Working…</span>}
        </div>

        {msg && <p className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</p>}

        <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-gray-500">Saved setting</dt><dd>{v.setting ? 'on' : 'off'}{v.lockedByEnv ? ' (env lock wins)' : ''}</dd>
          <dt className="text-gray-500">Last run</dt><dd>{when(v.lastRun?.at)}</dd>
          <dt className="text-gray-500">Last result</dt><dd>{lastRunText(v.lastRun)}{v.lastRun?.sample.length ? <span className="text-gray-500"> {v.lastRun.sample.join(', ')}</span> : null}</dd>
          <dt className="text-gray-500">Last preview</dt>
          <dd>{v.lastPreview ? `${when(v.lastPreview.at)} by ${v.lastPreview.by}: ${v.lastPreview.stops} stops, ${v.lastPreview.starts} starts, ${v.lastPreview.pushes} config pushes` : 'never'}</dd>
        </dl>
      </div>

      {confirm && plan && (
        <div className="card border-amber-300 bg-amber-50 space-y-2" role="dialog" aria-label="Confirm turning reconcile on">
          <div className="font-semibold">Turn reconcile on?</div>
          {plan.stopList.length > 0 ? (
            <div className="text-sm">
              <b>This will stop {plan.stopList.length} container{plan.stopList.length === 1 ? '' : 's'}:</b>{' '}
              <span className="font-mono">{plan.stopList.join(', ')}</span>.
            </div>
          ) : <div className="text-sm">This stops no containers.</div>}
          <div className="text-sm">It will also start {plan.totals.start}, reconfigure {plan.totals.reconfigure} and push config to {plan.totals.push} host{plan.totals.push === 1 ? '' : 's'}. See the preview below.</div>
          <div className="flex gap-2">
            <button type="button" className="btn !bg-red-600 hover:!bg-red-700" disabled={busy} onClick={() => setEnabled(true)}>Turn on</button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {plan && (
        <div className="card space-y-3" data-preview={plan.id}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">Preview (dry run, {when(plan.at)})</div>
              <div className="text-sm text-gray-600">
                If reconcile were on now: {plan.totals.stop} stops, {plan.totals.start} starts, {plan.totals.reconfigure} reconfigures, {plan.totals.push} config pushes. Nothing was sent.
              </div>
            </div>
            <label className="text-xs text-gray-600 flex items-center gap-1">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show unchanged
            </label>
          </div>
          {plan.hosts.map((h) => {
            const items = showAll ? h.items : h.items.filter((x) => x.action !== 'keep' && x.action !== 'leave' && x.action !== 'on-demand');
            return (
              <div key={h.hostId} className="border border-gray-200 rounded-lg p-3" data-plan-host={h.name}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${h.online ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <b>{h.name}</b>
                  <span className="text-gray-500">
                    {h.counts.stop} stop · {h.counts.start} start · {h.counts.reconfigure} reconfigure · {h.push ? `push config (rev ${h.push.pushedRev} → ${h.push.rev})` : 'no config push'} · {h.counts.keep} keep
                  </span>
                </div>
                {h.skipped && <div className="text-xs text-gray-500 mt-1">{h.skipped}</div>}
                {items.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {items.map((x, i) => (
                      <li key={i} className="text-xs flex flex-wrap items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded border font-semibold ${ACTION_STYLE[x.action]}`}>{ACTION_LABEL[x.action]}</span>
                        <span className="font-mono">{x.container ?? x.mode ?? x.role}</span>
                        <span className="text-gray-500">{x.why}</span>
                      </li>
                    ))}
                  </ul>
                ) : h.online && <div className="text-xs text-gray-400 mt-1">No changes.</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
