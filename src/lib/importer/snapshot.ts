/**
 * Read Sound Suite's fleet state into a plain snapshot. READ-ONLY: files open with
 * { readonly: true, fileMustExist: true }; only SELECT runs. Sound Suite is never written.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * Open a Sound Suite DB read-only. A live WAL DB on a read-only mount can refuse a direct open
 * (it needs the -shm file). Then copy the .db and -wal to a temp folder and read the copy.
 * The source files are never opened for writing.
 */
export function openReadOnly(file: string): { db: Database.Database; cleanup: () => void } {
  try {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    db.prepare('select count(*) from sqlite_master').get();
    return { db, cleanup: () => db.close() };
  } catch (e) {
    if (!fs.existsSync(file)) throw e;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-ss-'));
    const copy = path.join(dir, 'copy.db');
    fs.copyFileSync(file, copy);
    if (fs.existsSync(`${file}-wal`)) fs.copyFileSync(`${file}-wal`, `${copy}-wal`);
    const db = new Database(copy, { fileMustExist: true });
    return { db, cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
  }
}

export interface SsProvisioning {
  sidecarUrl: string; hostOsOverride: string | null; masterUrlForHost: string | null;
  masterWsPortForHost: number | null; notes: string | null;
}
export interface SsAssignment {
  sidecarUrl: string; mode: string; enabled: boolean; minOnline: number; idleTimeoutMin: number;
  modelOverride: string | null; runtime: string | null;
}
export interface SsSidecar {
  url: string; hostname: string | null; mode: string | null; status: string | null;
  lastSeen: string | null; lastSeenFromIp: string | null; containers: unknown;
}
export interface SoundSuiteSnapshot {
  source: string;
  takenAt: string;
  provisioning: SsProvisioning[];
  assignments: SsAssignment[];
  sidecars: SsSidecar[];
  openCommands: number;
  missingTables: string[];
}

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown, d: number): number => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const bool = (v: unknown): boolean => v === 1 || v === true || v === '1' || v === 'true';

function tables(db: Database.Database): Set<string> {
  return new Set((db.prepare("select name from sqlite_master where type='table'").all() as Row[]).map((r) => String(r.name)));
}

export function normalizeSidecars(raw: unknown): SsSidecar[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((o): o is Row => !!o && typeof o === 'object' && typeof (o as Row).url === 'string').map((o) => ({
    url: String(o.url), hostname: str(o.hostname), mode: str(o.mode), status: str(o.status),
    lastSeen: str(o.lastSeen), lastSeenFromIp: str(o.lastSeenFromIp), containers: o.containers ?? null,
  }));
}

/** systemDb has the fleet tables (tasks/56); configDb has Config.gpu.sidecars. They may be the same file. */
export function readSnapshot(systemDb: string, configDb: string = systemDb, now = new Date()): SoundSuiteSnapshot {
  const missing: string[] = [];
  const so = openReadOnly(systemDb);
  const sys = so.db;
  let provisioning: SsProvisioning[] = [];
  let assignments: SsAssignment[] = [];
  let openCommands = 0;
  try {
    const t = tables(sys);
    if (t.has('HostProvisioning')) {
      provisioning = (sys.prepare('select * from HostProvisioning').all() as Row[]).map((r) => ({
        sidecarUrl: String(r.sidecarUrl), hostOsOverride: str(r.hostOsOverride), masterUrlForHost: str(r.masterUrlForHost),
        masterWsPortForHost: r.masterWsPortForHost == null ? null : num(r.masterWsPortForHost, 0), notes: str(r.notes),
      }));
    } else missing.push('HostProvisioning');
    if (t.has('HostRoleAssignment')) {
      assignments = (sys.prepare('select * from HostRoleAssignment').all() as Row[]).map((r) => ({
        sidecarUrl: String(r.sidecarUrl), mode: String(r.mode), enabled: bool(r.enabled),
        minOnline: num(r.minOnline, 0), idleTimeoutMin: num(r.idleTimeoutMin, 5),
        modelOverride: str(r.modelOverride), runtime: str(r.runtime),
      }));
    } else missing.push('HostRoleAssignment');
    if (t.has('SidecarCommand')) {
      const cols = new Set((sys.prepare('pragma table_info(SidecarCommand)').all() as Row[]).map((r) => String(r.name)));
      openCommands = cols.has('status')
        ? num((sys.prepare("select count(*) n from SidecarCommand where status in ('pending','sent')").get() as Row).n, 0)
        : 0;
    }
  } finally { so.cleanup(); }

  let sidecars: SsSidecar[] = [];
  const co = openReadOnly(configDb);
  const cfg = co.db;
  try {
    if (tables(cfg).has('Config')) {
      const row = cfg.prepare("select value from Config where key='gpu.sidecars'").get() as Row | undefined;
      if (row) { try { sidecars = normalizeSidecars(JSON.parse(String(row.value))); } catch { /* bad JSON: no sidecars */ } }
    } else missing.push('Config');
  } finally { co.cleanup(); }

  return { source: systemDb === configDb ? systemDb : `${systemDb} + ${configDb}`, takenAt: now.toISOString(), provisioning, assignments, sidecars, openCommands, missingTables: missing };
}

/** Validate a snapshot loaded from JSON (export made inside the soundsuite container). */
export function parseSnapshot(raw: unknown): SoundSuiteSnapshot {
  if (!raw || typeof raw !== 'object') throw new Error('Snapshot must be a JSON object');
  const r = raw as Row;
  if (!Array.isArray(r.provisioning) || !Array.isArray(r.assignments)) throw new Error('Snapshot needs provisioning[] and assignments[]');
  return {
    source: str(r.source) ?? 'snapshot',
    takenAt: str(r.takenAt) ?? new Date().toISOString(),
    provisioning: (r.provisioning as Row[]).map((p) => ({
      sidecarUrl: String(p.sidecarUrl), hostOsOverride: str(p.hostOsOverride), masterUrlForHost: str(p.masterUrlForHost),
      masterWsPortForHost: p.masterWsPortForHost == null ? null : num(p.masterWsPortForHost, 0), notes: str(p.notes),
    })),
    assignments: (r.assignments as Row[]).map((a) => ({
      sidecarUrl: String(a.sidecarUrl), mode: String(a.mode), enabled: bool(a.enabled),
      minOnline: num(a.minOnline, 0), idleTimeoutMin: num(a.idleTimeoutMin, 5),
      modelOverride: str(a.modelOverride), runtime: str(a.runtime),
    })),
    sidecars: normalizeSidecars(r.sidecars),
    openCommands: num(r.openCommands, 0),
    missingTables: Array.isArray(r.missingTables) ? r.missingTables.map(String) : [],
  };
}
