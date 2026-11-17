/**
 * Dry run of the reconcile loop: per host, what turning reconcile on WOULD do. Sends nothing and
 * writes nothing to the hosts. Mirrors reconcileOnce() (push config, start, stop on hosts with
 * Host.reconcileEnabled) followed by enforceMinOnline() (start on any online host until the
 * min-online count is met).
 */
import { prisma } from '../db';
import { getFleetStatus, type ContainerLive } from '../fleet/interfaces';
import { buildHostPolicy, runningRoles } from './policy';
import { knownRoles, MAX_TRIES } from './reconcile';

/** What the loop would do with one role or container. */
export type PlanAction = 'keep' | 'start' | 'stop' | 'reconfigure' | 'on-demand' | 'leave' | 'gave-up';

export interface PlanItem {
  action: PlanAction;
  role: string;
  appId: string | null;
  mode: string | null;
  /** Container name as the sidecar reports it, if there is one. */
  container: string | null;
  /** Reported container state, or null when there is no container. */
  state: string | null;
  why: string;
}

export interface PlanDesired { appId: string; mode: string; role: string; enabled: boolean; minOnline: number; model?: string | null; port?: number | null }

export interface PlanHostInput {
  hostId: string; name: string; online: boolean;
  /** Host.reconcileEnabled: the per-host flag reconcileOnce() reads. */
  reconcileEnabled: boolean;
  policyRev: number; pushedPolicyRev: number;
  containers: ContainerLive[];
  desired: PlanDesired[];
  /** `${appId}|${mode}|${action}` the loop already gave up on (MAX_TRIES reached). */
  gaveUp?: Set<string>;
}

export interface HostPlan {
  hostId: string; name: string; online: boolean; reconcileEnabled: boolean;
  /** Why nothing happens on this host, or null. */
  skipped: string | null;
  push: { rev: number; pushedRev: number } | null;
  items: PlanItem[];
  counts: { start: number; stop: number; reconfigure: number; push: number; keep: number };
}

export interface FleetPlan { at: string; hosts: HostPlan[]; totals: { start: number; stop: number; reconfigure: number; push: number } }

const norm = (m: string | null | undefined) => (m ?? '').trim().toLowerCase().replace(/:latest$/, '');

/** Pure planner over fake or live hosts. `known` maps sidecar role → (appId, mode) for every catalog mode. */
export function planFleet(input: PlanHostInput[], known: Map<string, { appId: string; mode: string }>, now = new Date()): FleetPlan {
  const plans: HostPlan[] = input.map((h) => ({
    hostId: h.hostId, name: h.name, online: h.online, reconcileEnabled: h.reconcileEnabled,
    skipped: !h.online ? 'offline: the loop skips hosts that are not connected' : null,
    push: null, items: [], counts: { start: 0, stop: 0, reconfigure: 0, push: 0, keep: 0 },
  }));
  // Roles running after the reconcile pass (for the min-online step that follows it).
  const runningAfter = new Map<string, Set<string>>();
  const startItem = new Map<string, PlanItem>();

  input.forEach((h, i) => {
    const p = plans[i];
    if (!h.online) return;
    const byRole = new Map<string, ContainerLive>();
    for (const c of h.containers) if (c.role) byRole.set(c.role, c);
    const running = runningRoles(h.containers);
    const after = new Set(running);
    runningAfter.set(h.hostId, after);
    const needsPush = h.pushedPolicyRev < h.policyRev;
    if (h.reconcileEnabled && needsPush) p.push = { rev: h.policyRev, pushedRev: h.pushedPolicyRev };
    const want = new Set<string>();
    for (const d of h.desired) {
      const c = byRole.get(d.role) ?? null;
      const base = { role: d.role, appId: d.appId, mode: d.mode, container: c?.name ?? null, state: c?.state ?? null };
      if (!d.enabled) continue; // handled below as "not assigned"
      want.add(d.role);
      if (running.has(d.role)) {
        const diffs: string[] = [];
        if (d.model && c?.model && norm(c.model) !== norm(d.model)) diffs.push(`model ${c.model} → ${d.model}`);
        if (d.port && c?.port && c.port > 0 && c.port !== d.port) diffs.push(`port ${c.port} → ${d.port}`);
        if (p.push && diffs.length) p.items.push({ ...base, action: 'reconfigure', why: `assigned and running; the config push changes ${diffs.join(', ')}` });
        else p.items.push({ ...base, action: 'keep', why: 'assigned and running' });
        continue;
      }
      const what = c ? `container is ${c.state || 'not running'}` : 'no container yet';
      if (d.minOnline > 0 && h.reconcileEnabled) {
        if (h.gaveUp?.has(`${d.appId}|${d.mode}|start`)) { p.items.push({ ...base, action: 'gave-up', why: `assigned, ${what}; the loop gave up after ${MAX_TRIES} failed starts` }); continue; }
        const it: PlanItem = { ...base, action: 'start', why: `assigned (min online ${d.minOnline}), ${what}` };
        p.items.push(it); startItem.set(`${h.hostId}|${d.role}`, it); after.add(d.role);
      } else if (d.minOnline > 0) {
        // Host reconcile flag off: only the min-online step below may start it.
        const it: PlanItem = { ...base, action: 'on-demand', why: `assigned (min online ${d.minOnline}), ${what}; host reconcile is off` };
        p.items.push(it); startItem.set(`${h.hostId}|${d.role}`, it);
      } else {
        p.items.push({ ...base, action: 'on-demand', why: `assigned, min online 0: ${what}; starts on the first request, not by reconcile` });
      }
    }
    // Containers that are not assigned (or assigned but disabled).
    for (const c of h.containers) {
      if (!c.role || want.has(c.role)) continue;
      const k = known.get(c.role);
      const base = { role: c.role, appId: k?.appId ?? c.appId ?? null, mode: k?.mode ?? null, container: c.name, state: c.state };
      if (!running.has(c.role)) { p.items.push({ ...base, action: 'leave', why: `not assigned, ${c.state || 'not running'}: nothing to do` }); continue; }
      if (!k) { p.items.push({ ...base, action: 'leave', why: 'running, but not a sidecarmaster role (no catalog mode): left alone' }); continue; }
      if (!h.reconcileEnabled) { p.items.push({ ...base, action: 'leave', why: 'running, not assigned; host reconcile is off, so it stays' }); continue; }
      if (h.gaveUp?.has(`${k.appId}|${k.mode}|stop`)) { p.items.push({ ...base, action: 'gave-up', why: `running, not assigned; the loop gave up after ${MAX_TRIES} failed stops` }); continue; }
      p.items.push({ ...base, action: 'stop', why: 'running, but not assigned to this host' });
      after.delete(c.role);
    }
  });

  // Min-online step (enforceMinOnline): per (app, mode), start on online hosts in hostId order
  // until `max(minOnline)` hosts run it. It ignores Host.reconcileEnabled.
  const byMode = new Map<string, { h: PlanHostInput; d: PlanDesired }[]>();
  for (const h of [...input].sort((a, b) => (a.hostId < b.hostId ? -1 : a.hostId > b.hostId ? 1 : 0))) {
    for (const d of h.desired) {
      if (!d.enabled || d.minOnline <= 0) continue;
      const k = `${d.appId}|${d.mode}`;
      byMode.set(k, [...(byMode.get(k) ?? []), { h, d }]);
    }
  }
  for (const list of byMode.values()) {
    const want = Math.max(...list.map((x) => x.d.minOnline));
    const online = list.filter((x) => x.h.online);
    let running = online.filter((x) => runningAfter.get(x.h.hostId)?.has(x.d.role)).length;
    for (const x of online) {
      if (running >= want) break;
      if (runningAfter.get(x.h.hostId)?.has(x.d.role)) continue;
      const it = startItem.get(`${x.h.hostId}|${x.d.role}`);
      if (it && it.action === 'on-demand') { it.action = 'start'; it.why = it.why.replace('; host reconcile is off', '; started by the min-online rule'); }
      runningAfter.get(x.h.hostId)?.add(x.d.role);
      running++;
    }
  }

  const order: Record<PlanAction, number> = { stop: 0, start: 1, reconfigure: 2, 'gave-up': 3, keep: 4, 'on-demand': 5, leave: 6 };
  for (const p of plans) {
    p.items.sort((a, b) => order[a.action] - order[b.action] || a.role.localeCompare(b.role));
    p.counts = {
      start: p.items.filter((x) => x.action === 'start').length,
      stop: p.items.filter((x) => x.action === 'stop').length,
      reconfigure: p.items.filter((x) => x.action === 'reconfigure').length,
      push: p.push ? 1 : 0,
      keep: p.items.filter((x) => x.action === 'keep').length,
    };
    if (p.online && !p.reconcileEnabled && !p.skipped) p.skipped = 'host reconcile flag is off: no push and no stops here (the min-online rule may still start roles)';
  }
  const sum = (k: 'start' | 'stop' | 'reconfigure' | 'push') => plans.reduce((n, p) => n + p.counts[k], 0);
  return { at: now.toISOString(), hosts: plans, totals: { start: sum('start'), stop: sum('stop'), reconfigure: sum('reconfigure'), push: sum('push') } };
}

/** Dry run on the live fleet (DB roles + relay status). Read only. */
export async function previewReconcile(): Promise<FleetPlan> {
  const fleet = await getFleetStatus();
  const [known, hosts, states] = await Promise.all([
    knownRoles(),
    prisma.host.findMany({ orderBy: { name: 'asc' } }),
    prisma.reconcileState.findMany({ where: { tries: { gte: MAX_TRIES } } }),
  ]);
  const input: PlanHostInput[] = [];
  for (const h of hosts) {
    const live = await fleet.get(h.id);
    const p = await buildHostPolicy(h.id);
    input.push({
      hostId: h.id, name: h.name, online: !!live?.online, reconcileEnabled: h.reconcileEnabled,
      policyRev: h.policyRev, pushedPolicyRev: h.pushedPolicyRev,
      containers: live?.containers ?? [],
      desired: (p?.roles ?? []).map((r) => ({ appId: r.appId, mode: r.mode, role: r.role, enabled: r.enabled, minOnline: r.minOnline, model: r.model, port: r.port })),
      gaveUp: new Set(states.filter((s) => s.hostId === h.id).map((s) => `${s.appId}|${s.mode}|${s.action}`)),
    });
  }
  const plan = planFleet(input, known);
  // Show the hosts with something to do first, the rest by name.
  plan.hosts.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  return plan;
}

/** "GPUWS34 ss-embedding, GPUWS34 ss-reranker" for the confirm dialog. */
export function stopList(plan: FleetPlan): string[] {
  return plan.hosts.flatMap((h) => h.items.filter((x) => x.action === 'stop').map((x) => `${h.name} ${x.container ?? x.role}`));
}
