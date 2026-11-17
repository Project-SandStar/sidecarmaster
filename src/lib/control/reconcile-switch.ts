/**
 * The reconcile on/off switch.
 *  - DB setting `reconcile.enabled` ('1' on, anything else off). No row = OFF, so a fresh install
 *    and an install that drops SM_RECONCILE=0 from the env file both stay off until an admin turns it on.
 *  - Env SM_RECONCILE=0 is a hard override: reconcile is off and the Settings switch cannot turn it on.
 * Server only (reads the DB). Client components get the result as a prop.
 */
import { getJsonSetting, getSetting, setSetting } from '../settings';

export const RECONCILE_KEY = 'reconcile.enabled';
export const RECONCILE_LAST_RUN_KEY = 'reconcile.lastRun';
export const RECONCILE_LAST_PREVIEW_KEY = 'reconcile.lastPreview';
/** Turning reconcile on needs a preview this fresh (ms). */
export const PREVIEW_MAX_AGE_MS = 10 * 60_000;

/** SM_RECONCILE=0 in the env locks reconcile off. */
export function envLocksReconcile(env: Record<string, string | undefined> = process.env): boolean {
  return env.SM_RECONCILE === '0';
}

export interface ReconcileSwitch {
  /** True when the loop may act (setting on and no env lock). */
  on: boolean;
  /** The saved Settings value. */
  setting: boolean;
  lockedByEnv: boolean;
  /** Why it is off, for banners and errors; null when on. */
  reason: string | null;
}

export const ENV_LOCK_TEXT = 'locked off by SM_RECONCILE=0 in sidecarmaster.env';

export async function reconcileSwitch(env: Record<string, string | undefined> = process.env): Promise<ReconcileSwitch> {
  const lockedByEnv = envLocksReconcile(env);
  const setting = (await getSetting(RECONCILE_KEY)) === '1';
  const on = setting && !lockedByEnv;
  return { on, setting, lockedByEnv, reason: on ? null : lockedByEnv ? `SM_RECONCILE=0: ${ENV_LOCK_TEXT}` : 'turned off in Settings → Reconcile' };
}

/** True while reconcile must not push config or start or stop containers. */
export async function reconcileOff(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  return !(await reconcileSwitch(env)).on;
}

export async function setReconcileEnabled(on: boolean): Promise<void> {
  await setSetting(RECONCILE_KEY, on ? '1' : '0');
}

/** Summary of the last real pass of the loop (or "Run once"). */
export interface LastRun {
  at: string; hosts: number; fixes: number; done: number; failed: number; gaveUp: number;
  skipped: string | null; minOnlineStarted: number; error?: string | null;
  /** First few fixes, for the Settings page. */
  sample: string[];
}

export async function getLastRun(): Promise<LastRun | null> {
  return getJsonSetting<LastRun | null>(RECONCILE_LAST_RUN_KEY, null);
}

export async function saveLastRun(r: LastRun): Promise<void> {
  await setSetting(RECONCILE_LAST_RUN_KEY, JSON.stringify(r));
}

export interface LastPreview { id: string; at: string; by: string; stops: number; starts: number; pushes: number }

export async function getLastPreview(): Promise<LastPreview | null> {
  return getJsonSetting<LastPreview | null>(RECONCILE_LAST_PREVIEW_KEY, null);
}

export async function saveLastPreview(p: LastPreview): Promise<void> {
  await setSetting(RECONCILE_LAST_PREVIEW_KEY, JSON.stringify(p));
}

/** A preview counts for "turn on" when it is the newest one and younger than PREVIEW_MAX_AGE_MS. */
export function previewIsFresh(p: LastPreview | null, id: unknown, now = Date.now()): boolean {
  if (!p || typeof id !== 'string' || !id || p.id !== id) return false;
  const at = Date.parse(p.at);
  return Number.isFinite(at) && now - at >= 0 && now - at <= PREVIEW_MAX_AGE_MS;
}
