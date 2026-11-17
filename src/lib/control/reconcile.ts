/**
 * Task 3.4: reconcile loop. Every 30 s compare desired (role rows) with reported (live containers):
 *  - policy changed since the last push → push config
 *  - enabled role with minOnline > 0 not running → start
 *  - role running that is disabled or not assigned → stop
 * Each fix is tried at most MAX_TRIES times per (host, app, mode); then the loop gives up until the
 * desired state changes or the fix works. Every action writes an audit row (actor 'reconcile').
 */
import { prisma } from '../db';
import { audit } from '../audit';
import { getCommandSender, getFleetStatus, type CommandSender, type HostLive } from '../fleet/interfaces';
import { buildHostPolicy, pushConfig, runningRoles } from './policy';
import { publish } from './events';

export const MAX_TRIES = 3;
export const RECONCILE_INTERVAL_MS = 30_000;

export type FixAction = 'push-config' | 'start' | 'stop';
export interface Fix { hostId: string; appId: string; mode: string; role: string; action: FixAction }

/** Pure diff: what must change on one host. `known` maps sidecar role → (appId, mode) for every catalog mode. */
export function diffHost(
  live: HostLive,
  desired: { appId: string; mode: string; role: string; enabled: boolean; minOnline: number }[],
  needsPush: boolean,
  known: Map<string, { appId: string; mode: string }>,
): Fix[] {
  const fixes: Fix[] = [];
  if (needsPush) fixes.push({ hostId: live.hostId, appId: '*', mode: '*', role: '*', action: 'push-config' });
  const running = runningRoles(live.containers);
  const want = new Set<string>();
  for (const d of desired) {
    if (d.enabled) want.add(d.role);
    if (d.enabled && d.minOnline > 0 && !running.has(d.role)) fixes.push({ hostId: live.hostId, appId: d.appId, mode: d.mode, role: d.role, action: 'start' });
  }
  for (const r of running) {
    if (want.has(r)) continue;
    const k = known.get(r);
    if (!k) continue; // not ours (another tool's container): leave it alone
    fixes.push({ hostId: live.hostId, appId: k.appId, mode: k.mode, role: r, action: 'stop' });
  }
  return fixes;
}

export interface ReconcileReport { hosts: number; fixes: Fix[]; done: Fix[]; failed: Fix[]; gaveUp: Fix[]; skipped: string | null }

export async function knownRoles(): Promise<Map<string, { appId: string; mode: string }>> {
  const modes = await prisma.appMode.findMany({ select: { appId: true, name: true } });
  return new Map(modes.map((m) => [m.appId === 'soundsuite' ? m.name.replace(/^ss-/, '') : m.name, { appId: m.appId, mode: m.name }]));
}

/** One pass over every online host with reconcile on. */
export async function reconcileOnce(sender: CommandSender | null = getCommandSender()): Promise<ReconcileReport> {
  const rep: ReconcileReport = { hosts: 0, fixes: [], done: [], failed: [], gaveUp: [], skipped: null };
  if (!sender) { rep.skipped = 'no-relay'; return rep; }
  const fleet = await getFleetStatus();
  const known = await knownRoles();
  const hosts = await prisma.host.findMany({ where: { reconcileEnabled: true } });
  for (const h of hosts) {
    const live = await fleet.get(h.id);
    if (!live?.online) continue;
    rep.hosts++;
    const p = await buildHostPolicy(h.id);
    if (!p) continue;
    const fixes = diffHost(live, p.roles, h.pushedPolicyRev < h.policyRev, known);
    // Fixes that are no longer needed: clear their memory.
    const keys = new Set(fixes.map((f) => `${f.appId}|${f.mode}`));
    await prisma.reconcileState.deleteMany({ where: { hostId: h.id, NOT: { OR: [...keys].map((k) => ({ appId: k.split('|')[0], mode: k.split('|')[1] })) } } });
    for (const f of fixes) {
      rep.fixes.push(f);
      const key = { hostId_appId_mode: { hostId: f.hostId, appId: f.appId, mode: f.mode } };
      const st = await prisma.reconcileState.findUnique({ where: key });
      // A new revision or a different action resets the counter.
      const fresh = !st || st.action !== f.action || (f.action === 'push-config' && st.lastError?.startsWith(`rev ${h.policyRev}:`) === false);
      const tries = fresh ? 0 : st!.tries;
      if (tries >= MAX_TRIES) {
        if (!st!.gaveUp) {
          await prisma.reconcileState.update({ where: key, data: { gaveUp: true } });
          await audit('reconcile', 'reconcile.give-up', `${h.name}:${f.appId}/${f.mode}`, { action: f.action, tries });
          publish({ type: 'reconcile.give-up', appId: f.appId === '*' ? null : f.appId, hostId: h.id, data: f });
        }
        rep.gaveUp.push(f);
        continue;
      }
      let ok = false, error: string | null = null;
      try {
        if (f.action === 'push-config') { const r = await pushConfig(h.id, sender); ok = r.ok; error = r.error ?? null; }
        else { const r = await sender.send(h.id, f.action, { role: f.role }); ok = r.ok; error = r.error ?? null; }
      } catch (e) { error = e instanceof Error ? e.message : String(e); }
      const lastError = f.action === 'push-config' ? `rev ${h.policyRev}:${error ?? ''}` : error;
      await prisma.reconcileState.upsert({
        where: key,
        create: { hostId: f.hostId, appId: f.appId, mode: f.mode, action: f.action, tries: 1, lastError, gaveUp: false },
        update: { action: f.action, tries: tries + 1, lastTryAt: new Date(), lastError, gaveUp: false },
      });
      await audit('reconcile', `reconcile.${f.action}`, `${h.name}:${f.appId}/${f.mode}`, { ok, error, try: tries + 1 });
      publish({ type: `reconcile.${f.action}`, appId: f.appId === '*' ? null : f.appId, hostId: h.id, data: { ok, error, role: f.role } });
      (ok ? rep.done : rep.failed).push(f);
    }
  }
  return rep;
}

const g = globalThis as unknown as { __smReconcile?: NodeJS.Timeout };

/**
 * One real pass: the reconcile pass, then the min-online rule. Does nothing while the switch is off
 * (Settings → Reconcile, or SM_RECONCILE=0). Saves a summary for the Settings page.
 */
export async function runReconcilePass(sender: CommandSender | null = getCommandSender()): Promise<ReconcileReport & { minOnline: { started: string[]; failed: string[] } }> {
  const { reconcileOff, saveLastRun } = await import('./reconcile-switch');
  const none = { started: [] as string[], failed: [] as string[] };
  if (await reconcileOff()) return { hosts: 0, fixes: [], done: [], failed: [], gaveUp: [], skipped: 'reconcile-off', minOnline: none };
  let r: ReconcileReport;
  let m = none;
  let error: string | null = null;
  try {
    r = await reconcileOnce(sender);
    if (!r.skipped) {
      const { enforceMinOnline } = await import('./policy');
      m = await enforceMinOnline(sender);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    r = { hosts: 0, fixes: [], done: [], failed: [], gaveUp: [], skipped: 'error' };
  }
  await saveLastRun({
    at: new Date().toISOString(), hosts: r.hosts, fixes: r.fixes.length, done: r.done.length, failed: r.failed.length,
    gaveUp: r.gaveUp.length, skipped: r.skipped, minOnlineStarted: m.started.length, error,
    sample: [...r.done.map((f) => `${f.action} ${f.mode} ok`), ...r.failed.map((f) => `${f.action} ${f.mode} failed`)].slice(0, 8),
  }).catch(() => undefined);
  if (error) throw new Error(error);
  return { ...r, minOnline: m };
}

/** Start the 30 s loop (once per process). Each tick reads the switch, so Settings takes effect without a restart. */
export function startReconcileLoop(intervalMs = RECONCILE_INTERVAL_MS): void {
  if (g.__smReconcile) return;
  let busy = false;
  let wasOn: boolean | null = null;
  g.__smReconcile = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const { reconcileSwitch } = await import('./reconcile-switch');
      const sw = await reconcileSwitch();
      if (sw.on !== wasOn) { console.log(`[sidecarmaster] reconcile ${sw.on ? 'on' : `off (${sw.reason})`}`); wasOn = sw.on; }
      if (sw.on) await runReconcilePass();
    } catch (e) { console.error('[sidecarmaster] reconcile failed:', e instanceof Error ? e.message : e); }
    finally { busy = false; }
  }, intervalMs);
  g.__smReconcile.unref();
}

export function stopReconcileLoop(): void {
  if (g.__smReconcile) { clearInterval(g.__smReconcile); g.__smReconcile = undefined; }
}
