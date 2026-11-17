/**
 * Task 5.3: alert rules (SPEC §11). Pure: hosts + app health + clock in, conditions out.
 *  - host-down      no heartbeat for hostDownMin (warning), critical after hostCriticalMin
 *  - app-down       app health probe fails for appDownMin, or the app's master is not
 *                   connected from a host for appDownMin
 *  - update-failed  the sidecar reports a failed update
 *  - disk-low       free disk below diskFreePct
 *  - gpu-high       VRAM above gpuVramPct for gpuForMin
 * "host back up" is the close of a host-down alert (see engine.ts).
 */
import { getJsonSetting, setSetting } from '../settings';
import type { HostLive } from '../fleet/interfaces';
import { vramPct } from '../monitor/samples';

export interface RuleConfig {
  hostDownMin: number; hostCriticalMin: number; appDownMin: number;
  gpuVramPct: number; gpuForMin: number; diskFreePct: number; cooldownMin: number;
}
export const RULE_DEFAULTS: RuleConfig = {
  hostDownMin: 1, hostCriticalMin: 5, appDownMin: 2, gpuVramPct: 95, gpuForMin: 10, diskFreePct: 10, cooldownMin: 30,
};
const LIMITS: Record<keyof RuleConfig, [number, number]> = {
  hostDownMin: [1, 1440], hostCriticalMin: [1, 1440], appDownMin: [1, 1440],
  gpuVramPct: [1, 100], gpuForMin: [0, 1440], diskFreePct: [0, 100], cooldownMin: [0, 1440],
};
const KEY = 'alerts.rules';

export async function readRules(): Promise<RuleConfig> {
  return { ...RULE_DEFAULTS, ...(await getJsonSetting<Partial<RuleConfig>>(KEY, {})) };
}
export async function updateRules(body: unknown): Promise<RuleConfig> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const cur = await readRules();
  for (const k of Object.keys(LIMITS) as (keyof RuleConfig)[]) {
    if (b[k] === undefined) continue;
    const n = Number(b[k]);
    const [lo, hi] = LIMITS[k];
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${k} must be ${lo}-${hi}`);
    cur[k] = n;
  }
  await setSetting(KEY, JSON.stringify(cur));
  return cur;
}

export type Severity = 'warning' | 'critical';
export interface Condition {
  key: string; rule: string; severity: Severity; hostId?: string | null; appId?: string | null; message: string;
}
export interface AppHealth { appId: string; name: string; ok: boolean; error?: string | null }

/** Remembers when a "for N minutes" condition was first seen. */
export class PendingClock {
  private first = new Map<string, number>();
  /** True when `active` has held for at least forMs. */
  held(key: string, active: boolean, forMs: number, now: number): boolean {
    if (!active) { this.first.delete(key); return false; }
    const f = this.first.get(key) ?? now;
    this.first.set(key, f);
    return now - f >= forMs;
  }
}

const MIN = 60_000;
const fmtMin = (ms: number) => `${Math.max(1, Math.round(ms / MIN))} min`;

export function evaluate(
  hosts: HostLive[], apps: AppHealth[], cfg: RuleConfig, pending: PendingClock, now: number,
): Condition[] {
  const out: Condition[] = [];
  for (const h of hosts) {
    const age = h.lastHeartbeatAt ? now - h.lastHeartbeatAt.getTime() : Infinity;
    const down = age >= cfg.hostDownMin * MIN || (!h.online && !h.lastHeartbeatAt);
    if (down) {
      const crit = age >= cfg.hostCriticalMin * MIN;
      out.push({
        key: `host-down:${h.hostId}`, rule: 'host-down', severity: crit ? 'critical' : 'warning', hostId: h.hostId,
        message: Number.isFinite(age) ? `Sidecar on ${h.name} is down: no heartbeat for ${fmtMin(age)}` : `Sidecar on ${h.name} has never sent a heartbeat`,
      });
      continue; // a down host has no fresh data for the rules below
    }
    for (const m of h.masters ?? []) {
      if (!m.appId) continue;
      const k = `app-down:${m.appId}:${h.hostId}`;
      if (pending.held(k, !m.connected, cfg.appDownMin * MIN, now)) {
        out.push({ key: k, rule: 'app-down', severity: 'warning', hostId: h.hostId, appId: m.appId,
          message: `${h.name} cannot reach the ${m.appId} master (${m.url})${m.lastError ? `: ${m.lastError}` : ''}` });
      }
    }
    if (h.update?.state === 'failed') {
      out.push({ key: `update-failed:${h.hostId}:${h.update.product}`, rule: 'update-failed', severity: 'warning', hostId: h.hostId,
        message: `Update of ${h.update.product}${h.update.version ? ` to ${h.update.version}` : ''} failed on ${h.name}${h.update.error ? `: ${h.update.error}` : ''}` });
    }
    if (typeof h.diskFreePct === 'number' && h.diskFreePct < cfg.diskFreePct) {
      out.push({ key: `disk-low:${h.hostId}`, rule: 'disk-low', severity: 'warning', hostId: h.hostId,
        message: `Disk on ${h.name} is ${h.diskFreePct.toFixed(0)} % free (limit ${cfg.diskFreePct} %)` });
    }
    const vp = vramPct(h);
    const gk = `gpu-high:${h.hostId}`;
    if (pending.held(gk, vp !== null && vp > cfg.gpuVramPct, cfg.gpuForMin * MIN, now)) {
      out.push({ key: gk, rule: 'gpu-high', severity: 'warning', hostId: h.hostId,
        message: `GPU memory on ${h.name} is ${vp!.toFixed(0)} % used for ${cfg.gpuForMin} min (limit ${cfg.gpuVramPct} %)` });
    }
  }
  for (const a of apps) {
    const k = `app-down:${a.appId}`;
    if (pending.held(k, !a.ok, cfg.appDownMin * MIN, now)) {
      out.push({ key: k, rule: 'app-down', severity: 'critical', appId: a.appId,
        message: `${a.name} is down${a.error ? `: ${a.error}` : ''}` });
    }
  }
  return out;
}
