/**
 * Phase 5 background loop (started from instrumentation.ts):
 *  - every 30 s: alert rules (host off the network → alert in < 2 min)
 *  - every 60 s: one heartbeat sample per host
 *  - every hour: roll up + prune
 * Set SM_MONITOR=0 to turn it off.
 */
import { getFleetStatus } from '../fleet/interfaces';
import { getAppRegistry } from '../apps/interfaces';
import { runAlertCycle } from '../alerts/engine';
import { PendingClock } from '../alerts/rules';
import { Cooldown } from '../alerts/notify';
import { pruneSamples, recordSamples, rollupHours } from './samples';

const g = globalThis as unknown as { __smMonitor?: boolean };

export function startMonitor(log = console) {
  if (g.__smMonitor || process.env.SM_MONITOR === '0') return;
  g.__smMonitor = true;
  const pending = new PendingClock();
  const cooldown = new Cooldown();
  const safe = (name: string, fn: () => Promise<unknown>) => async () => {
    try { await fn(); } catch (e) { log.error(`[sidecarmaster] ${name} failed:`, e instanceof Error ? e.message : e); }
  };
  const alerts = safe('alerts', async () => {
    const r = await runAlertCycle({ fleet: await getFleetStatus(), apps: getAppRegistry(), pending, cooldown });
    if (r.errors.length) log.warn(`[sidecarmaster] alert email: ${r.errors[0]}`);
  });
  const sample = safe('samples', async () => recordSamples(await (await getFleetStatus()).list()));
  const hourly = safe('rollup', async () => { await rollupHours(); await pruneSamples(); });
  setTimeout(alerts, 15_000);
  setInterval(alerts, 30_000).unref();
  setInterval(sample, 60_000).unref();
  setInterval(hourly, 3600_000).unref();
}
