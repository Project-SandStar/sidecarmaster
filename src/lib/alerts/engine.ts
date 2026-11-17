/**
 * Task 5.3 + 5.4: turn rule conditions into Alert rows (open → ack → closed) and emails.
 *  - A new condition opens an alert and sends one email (unless muted or in cool-down).
 *  - A condition that is gone closes the alert. A closed host-down sends "host back up".
 *  - host-down going warning → critical updates the row and sends once more.
 */
import { prisma } from '../db';
import type { FleetStatus } from '../fleet/interfaces';
import type { AppRegistry } from '../apps/interfaces';
import { evaluate, PendingClock, readRules, type AppHealth, type Condition } from './rules';
import { Cooldown, emailNotifier, type Notifier } from './notify';

export type Probe = (url: string) => Promise<{ ok: boolean; error?: string }>;

export const httpProbe: Probe = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5_000), cache: 'no-store' });
    return r.ok ? { ok: true } : { ok: false, error: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e) };
  }
};

export interface EngineDeps {
  fleet: FleetStatus; apps: AppRegistry; probe?: Probe; notifier?: Notifier;
  pending?: PendingClock; cooldown?: Cooldown; now?: () => number;
}

export async function probeApps(apps: AppRegistry, probe: Probe): Promise<AppHealth[]> {
  const list = (await apps.list()).filter((a) => a.enabled);
  const out: AppHealth[] = [];
  await Promise.all(list.map(async (a) => {
    const url = await apps.healthUrl(a.id);
    if (!url) return;
    const r = await probe(url);
    out.push({ appId: a.id, name: a.displayName, ok: r.ok, error: r.error ?? null });
  }));
  return out.sort((a, b) => a.appId.localeCompare(b.appId));
}

async function activeMutes(now: Date) {
  return prisma.alertMute.findMany({ where: { until: { gt: now } } });
}
type Mute = Awaited<ReturnType<typeof activeMutes>>[number];
export function isMuted(c: Pick<Condition, 'rule' | 'hostId' | 'appId'>, mutes: Mute[]): boolean {
  return mutes.some((m) => (!m.rule || m.rule === c.rule) && (!m.hostId || m.hostId === c.hostId) && (!m.appId || m.appId === c.appId));
}

export interface CycleResult { opened: number; closed: number; sent: number; apps: AppHealth[]; errors: string[] }

export async function runAlertCycle(d: EngineDeps): Promise<CycleResult> {
  const nowMs = (d.now ?? Date.now)();
  const now = new Date(nowMs);
  const notifier = d.notifier ?? emailNotifier;
  const cooldown = d.cooldown ?? new Cooldown();
  const cfg = await readRules();
  const coolMs = cfg.cooldownMin * 60_000;
  const [hosts, apps] = await Promise.all([d.fleet.list(), probeApps(d.apps, d.probe ?? httpProbe)]);
  const conds = evaluate(hosts, apps, cfg, d.pending ?? new PendingClock(), nowMs);
  const mutes = await activeMutes(now);
  const open = await prisma.alert.findMany({ where: { state: { in: ['open', 'ack'] } } });
  const byKey = new Map(open.map((a) => [a.key, a]));
  const res: CycleResult = { opened: 0, closed: 0, sent: 0, apps, errors: [] };

  const send = async (key: string, subject: string, text: string, alertId?: string) => {
    if (!cooldown.allow(key, coolMs, nowMs)) return;
    try {
      await notifier.send(subject, text);
      res.sent++;
      if (alertId) await prisma.alert.update({ where: { id: alertId }, data: { notifiedAt: now } });
    } catch (e) { res.errors.push(e instanceof Error ? e.message : String(e)); }
  };

  const seen = new Set<string>();
  for (const c of conds) {
    seen.add(c.key);
    const muted = isMuted(c, mutes);
    const cur = byKey.get(c.key);
    if (!cur) {
      const a = await prisma.alert.create({ data: { key: c.key, rule: c.rule, severity: c.severity, hostId: c.hostId ?? null, appId: c.appId ?? null, message: c.message, openedAt: now, muted } });
      res.opened++;
      if (!muted) await send(c.key, `[sidecarmaster] ${c.severity.toUpperCase()}: ${c.message}`, `${c.message}\n\nRule: ${c.rule}\nOpened: ${now.toISOString()}\n`, a.id);
    } else {
      const escalated = cur.severity !== 'critical' && c.severity === 'critical';
      await prisma.alert.update({ where: { id: cur.id }, data: { message: c.message, severity: c.severity } });
      if (escalated && !muted && !cur.muted && cur.state === 'open') {
        await send(`${c.key}:critical`, `[sidecarmaster] CRITICAL: ${c.message}`, `${c.message}\n\nRule: ${c.rule}\nNow critical at ${now.toISOString()}.\n`, cur.id);
      }
    }
  }
  for (const a of open) {
    if (seen.has(a.key)) continue;
    await prisma.alert.update({ where: { id: a.id }, data: { state: 'closed', closedAt: now } });
    res.closed++;
    if (a.rule === 'host-down' && !a.muted && !isMuted(a, mutes)) {
      const host = hosts.find((h) => h.hostId === a.hostId);
      const name = host?.name ?? a.hostId ?? '?';
      const mins = Math.max(1, Math.round((nowMs - a.openedAt.getTime()) / 60_000));
      await send(`host-up:${a.hostId}`, `[sidecarmaster] OK: ${name} is back up`, `The sidecar on ${name} sends heartbeats again after about ${mins} min.\n`);
    }
  }
  return res;
}

export async function alertCounts() {
  const [open, ack] = await Promise.all([
    prisma.alert.count({ where: { state: 'open', muted: false } }),
    prisma.alert.count({ where: { state: 'ack' } }),
  ]);
  return { open, ack };
}
