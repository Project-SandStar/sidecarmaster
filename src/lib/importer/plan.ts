/**
 * Turn a Sound Suite snapshot into sidecarmaster rows (SPEC §5.3) and apply them.
 *
 * One real box = one Host. Sound Suite keys sidecars by URL, and the same box shows up
 * under several URLs (LAN IP, NetBird IP, DHCP moves). URLs with the same reported hostname
 * are grouped into one host; every URL is kept in HostAlias. Existing duplicate Host rows
 * (from an older import) are merged into one.
 * Upsert by natural keys, so a re-run gives the same rows.
 */
import type { PrismaClient } from '@prisma/client';
import { APP_SEEDS, MODE_SEEDS, modeSeedRow } from '../apps/catalog';
import { hostKey } from '../fleet/host-identity';
import type { SoundSuiteSnapshot } from './snapshot';

export interface PlannedHost {
  /** Primary URL (Host.agentUrl on create). */
  agentUrl: string;
  /** All URLs of this box, primary first. */
  aliases: string[];
  hostname: string | null;
  name: string; hostOsOverride: string | null; netbirdIp: string | null;
  lastHeartbeatAt: string | null; lastSeenFromIp: string | null; statusSnapshot: string | null; note: string | null;
}
export interface PlannedHostApp { agentUrl: string; appId: string; masterUrlOverride: string | null; wsPortOverride: number | null }
export interface PlannedRole {
  agentUrl: string; appId: string; mode: string; enabled: boolean; minOnline: number; idleTimeoutMin: number;
  modelOverride: string | null; runtime: string | null;
}
export interface ImportPlan {
  hosts: PlannedHost[]; hostApps: PlannedHostApp[]; roles: PlannedRole[]; warnings: string[];
}
export interface ImportReport {
  dryRun: boolean; source: string; takenAt: string;
  apps: { created: number; unchanged: number }; modes: { created: number; unchanged: number };
  hosts: { created: number; updated: number; merged: number }; aliases: { created: number };
  hostApps: { created: number; updated: number };
  roles: { created: number; updated: number }; warnings: string[];
}

export function urlHost(u: string): string | null {
  try { return new URL(u).hostname; } catch { return null; }
}

const isNetbirdIp = (h: string | null) => !!h && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/.test(h);
export const norm = (u: string) => u.trim().replace(/\/+$/, '');

/** Host name: reported hostname (without .local), else the URL host. Unique per plan. */
function nameFor(url: string, reported: string | null, used: Set<string>): string {
  const base = (reported?.replace(/\.local$/i, '') || urlHost(url) || url).trim();
  let n = base; let i = 2;
  while (used.has(n.toLowerCase())) n = `${base}-${i++}`;
  used.add(n.toLowerCase());
  return n;
}

/**
 * Grouping hints for URLs Sound Suite reports without a hostname. Key: normalized URL.
 * Value: a hostname key, or `host:<id>` for a host row with no hostname. Built from HostAlias,
 * so a URL that was merged into a host stays with that host on the next import.
 */
export type GroupHints = Map<string, string>;

export function buildPlan(s: SoundSuiteSnapshot, hints: GroupHints = new Map()): ImportPlan {
  const warnings: string[] = [];
  if (s.missingTables.length) warnings.push(`Missing tables in Sound Suite DB: ${s.missingTables.join(', ')}`);
  const urls = new Set<string>();
  for (const p of s.provisioning) urls.add(norm(p.sidecarUrl));
  for (const a of s.assignments) urls.add(norm(a.sidecarUrl));
  for (const c of s.sidecars) urls.add(norm(c.url));

  const byUrl = new Map(s.sidecars.map((c) => [norm(c.url), c]));
  const provByUrl = new Map(s.provisioning.map((p) => [norm(p.sidecarUrl), p]));

  // Group URLs by hostname key; URLs with no known hostname stay alone.
  const groups = new Map<string, string[]>();
  for (const url of [...urls].sort()) {
    const k = hostKey(byUrl.get(url)?.hostname) ?? hints.get(url) ?? `url:${url}`;
    groups.set(k, [...(groups.get(k) ?? []), url]);
  }

  const used = new Set<string>();
  const hosts: PlannedHost[] = [];
  const primaryOf = new Map<string, string>();
  for (const [k, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Primary: the URL Sound Suite saw most recently; ties -> connected, NetBird IP, then sort order.
    const rank = (u: string) => {
      const sc = byUrl.get(u);
      return [sc?.lastSeen ? Date.parse(sc.lastSeen) || 0 : 0, sc?.status === 'connected' ? 1 : 0, isNetbirdIp(urlHost(u)) ? 1 : 0];
    };
    const sorted = [...list].sort((a, b) => {
      const x = rank(a); const y = rank(b);
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2] || a.localeCompare(b);
    });
    const primary = sorted[0];
    for (const u of sorted) primaryOf.set(u, primary);
    if (sorted.length > 1) warnings.push(`Merged ${sorted.length} URLs of host "${k}" into one host (${sorted.join(', ')}).`);

    const sc = byUrl.get(primary) ?? null;
    const prov = sorted.map((u) => provByUrl.get(u)).find(Boolean) ?? null;
    const nb = sorted.map(urlHost).find(isNetbirdIp) ?? null;
    const newest = sorted.map((u) => byUrl.get(u)?.lastSeen ?? null).filter((x): x is string => !!x).sort().pop() ?? null;
    hosts.push({
      agentUrl: primary,
      aliases: sorted,
      hostname: k.startsWith('url:') || k.startsWith('host:') ? null : k,
      name: nameFor(primary, sorted.map((u) => byUrl.get(u)?.hostname).find(Boolean) ?? null, used),
      hostOsOverride: prov?.hostOsOverride ?? null,
      netbirdIp: nb,
      lastHeartbeatAt: newest,
      lastSeenFromIp: sc?.lastSeenFromIp ?? null,
      statusSnapshot: sc ? JSON.stringify({ status: sc.status, mode: sc.mode, containers: sc.containers }) : null,
      note: prov?.notes ?? null,
    });
  }

  const hostApps: PlannedHostApp[] = [];
  for (const p of s.provisioning) {
    const pu = primaryOf.get(norm(p.sidecarUrl))!;
    if (hostApps.some((x) => x.agentUrl === pu)) { warnings.push(`Two provisioning rows for one host (${p.sidecarUrl}); kept the first.`); continue; }
    hostApps.push({ agentUrl: pu, appId: 'soundsuite', masterUrlOverride: p.masterUrlForHost, wsPortOverride: p.masterWsPortForHost });
  }
  // A host with roles but no provisioning row still serves Sound Suite.
  for (const a of s.assignments) {
    const pu = primaryOf.get(norm(a.sidecarUrl))!;
    if (!hostApps.some((x) => x.agentUrl === pu)) hostApps.push({ agentUrl: pu, appId: 'soundsuite', masterUrlOverride: null, wsPortOverride: null });
  }

  const known = new Set(MODE_SEEDS.filter((m) => m.appId === 'soundsuite').map((m) => m.name));
  const roles = new Map<string, PlannedRole>();
  for (const a of s.assignments) {
    const pu = primaryOf.get(norm(a.sidecarUrl))!;
    const k = `${pu}|${a.mode}`;
    const prev = roles.get(k);
    if (!known.has(a.mode)) warnings.push(`Unknown Sound Suite mode "${a.mode}" on ${a.sidecarUrl}; imported as is.`);
    const row: PlannedRole = { ...a, agentUrl: pu, appId: 'soundsuite' };
    if (!prev) { roles.set(k, row); continue; }
    // Same mode under two URLs of one box: prefer the row from the primary URL, else an enabled one.
    if (norm(a.sidecarUrl) === pu || (!prev.enabled && a.enabled)) roles.set(k, row);
    warnings.push(`Role ${a.mode} set under several URLs of one host (${pu}); kept one.`);
  }
  return { hosts, hostApps, roles: [...roles.values()], warnings };
}

const same = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  Object.keys(a).every((k) => {
    const x = a[k] instanceof Date ? (a[k] as Date).toISOString() : a[k];
    const y = b[k] instanceof Date ? (b[k] as Date).toISOString() : b[k];
    return (x ?? null) === (y ?? null);
  });

type Tx = PrismaClient;

/** Fold host `from` into host `into`: move apps, roles, aliases, commands; delete `from`. */
export async function mergeHostRows(tx: Tx, into: string, from: string): Promise<void> {
  for (const ha of await tx.hostApp.findMany({ where: { hostId: from } })) {
    const clash = await tx.hostApp.findUnique({ where: { hostId_appId: { hostId: into, appId: ha.appId } } });
    if (clash) await tx.hostApp.delete({ where: { id: ha.id } });
    else await tx.hostApp.update({ where: { id: ha.id }, data: { hostId: into } });
  }
  for (const r of await tx.roleAssignment.findMany({ where: { hostId: from } })) {
    const clash = await tx.roleAssignment.findUnique({ where: { hostId_appId_mode: { hostId: into, appId: r.appId, mode: r.mode } } });
    if (clash) await tx.roleAssignment.delete({ where: { id: r.id } });
    else await tx.roleAssignment.update({ where: { id: r.id }, data: { hostId: into } });
  }
  await tx.hostAlias.updateMany({ where: { hostId: from }, data: { hostId: into } });
  await tx.command.updateMany({ where: { hostId: from }, data: { hostId: into } });
  const old = await tx.host.findUnique({ where: { id: from } });
  await tx.host.delete({ where: { id: from } });
  // Keep the merged row's old agentUrl as an alias.
  if (old?.agentUrl) {
    await tx.hostAlias.upsert({ where: { url: old.agentUrl }, create: { url: old.agentUrl, hostId: into, source: 'soundsuite-import' }, update: { hostId: into } });
  }
}

/** Drop URLs on the ignore list (setting importer.ignoreUrls) from every part of the snapshot. */
export function dropIgnored(s: SoundSuiteSnapshot, ignore: Iterable<string>): SoundSuiteSnapshot {
  const ig = new Set([...ignore].map(norm));
  if (!ig.size) return s;
  return {
    ...s,
    provisioning: s.provisioning.filter((p) => !ig.has(norm(p.sidecarUrl))),
    assignments: s.assignments.filter((a) => !ig.has(norm(a.sidecarUrl))),
    sidecars: s.sidecars.filter((c) => !ig.has(norm(c.url))),
  };
}

/** Apply a plan. With dryRun, nothing is written; the report shows what would change. */
export async function applyPlan(db: PrismaClient, s: SoundSuiteSnapshot, plan: ImportPlan, dryRun: boolean): Promise<ImportReport> {
  const r: ImportReport = {
    dryRun, source: s.source, takenAt: s.takenAt,
    apps: { created: 0, unchanged: 0 }, modes: { created: 0, unchanged: 0 },
    hosts: { created: 0, updated: 0, merged: 0 }, aliases: { created: 0 },
    hostApps: { created: 0, updated: 0 }, roles: { created: 0, updated: 0 },
    warnings: [...plan.warnings],
  };

  const run = async (tx: Tx) => {
    for (const a of APP_SEEDS) {
      if (await tx.app.findUnique({ where: { id: a.id } })) { r.apps.unchanged++; continue; }
      r.apps.created++;
      if (!dryRun) await tx.app.create({ data: a });
    }
    for (const m of MODE_SEEDS) {
      if (await tx.appMode.findUnique({ where: { appId_name: { appId: m.appId, name: m.name } } })) { r.modes.unchanged++; continue; }
      r.modes.created++;
      if (!dryRun) await tx.appMode.create({ data: modeSeedRow(m) });
    }

    const hostId = new Map<string, string>();
    for (const h of plan.hosts) {
      // Every existing row that belongs to this box: by alias URL, by agentUrl, by hostname.
      const ids = new Set<string>();
      for (const a of await tx.hostAlias.findMany({ where: { url: { in: h.aliases } } })) ids.add(a.hostId);
      for (const x of await tx.host.findMany({ where: { agentUrl: { in: h.aliases } } })) ids.add(x.id);
      if (h.hostname) for (const x of await tx.host.findMany({ where: { hostname: h.hostname } })) ids.add(x.id);
      const rows = ids.size ? await tx.host.findMany({ where: { id: { in: [...ids] } }, orderBy: { createdAt: 'asc' } }) : [];

      const data = {
        hostOsOverride: h.hostOsOverride, netbirdIp: h.netbirdIp, hostname: h.hostname,
        lastSeenFromIp: h.lastSeenFromIp, statusSnapshot: h.statusSnapshot, note: h.note,
      };
      let id: string;
      if (rows.length) {
        // Keep the oldest row (its id may be referenced, its name may be admin-chosen).
        const keep = rows[0];
        id = keep.id;
        for (const dup of rows.slice(1)) {
          r.hosts.merged++;
          if (!dryRun) await mergeHostRows(tx, keep.id, dup.id);
        }
        // Heartbeat: keep the newer of import and relay. agentUrl: the relay owns it once set.
        const hb = h.lastHeartbeatAt ? new Date(h.lastHeartbeatAt) : null;
        const upd: Record<string, unknown> = { ...data };
        if (hb && (!keep.lastHeartbeatAt || hb > keep.lastHeartbeatAt)) upd.lastHeartbeatAt = hb;
        if (!keep.agentUrl || rows.length > 1) {
          const cur = keep.agentUrl && h.aliases.includes(keep.agentUrl) ? keep.agentUrl : h.agentUrl;
          if (cur !== keep.agentUrl) upd.agentUrl = cur;
        }
        if (!same(upd, keep as unknown as Record<string, unknown>)) {
          r.hosts.updated++;
          if (!dryRun) await tx.host.update({ where: { id }, data: upd });
        }
      } else {
        r.hosts.created++;
        let name = h.name;
        if (await tx.host.findUnique({ where: { name } })) { name = `${name}-${urlHost(h.agentUrl) ?? 'x'}`; r.warnings.push(`Host name "${h.name}" taken; used "${name}".`); }
        if (!dryRun) {
          const c = await tx.host.create({
            data: { ...data, name, agentUrl: h.agentUrl, lastHeartbeatAt: h.lastHeartbeatAt ? new Date(h.lastHeartbeatAt) : null, source: 'soundsuite-import' },
          });
          id = c.id;
        } else id = `dry:${h.agentUrl}`;
      }
      hostId.set(h.agentUrl, id);

      for (const url of h.aliases) {
        const ex = await tx.hostAlias.findUnique({ where: { url } });
        if (ex && ex.hostId === id) continue;
        if (!ex) r.aliases.created++;
        if (!dryRun) await tx.hostAlias.upsert({ where: { url }, create: { url, hostId: id, source: 'soundsuite-import' }, update: { hostId: id } });
      }
    }

    for (const ha of plan.hostApps) {
      const hid = hostId.get(ha.agentUrl)!;
      const data = { masterUrlOverride: ha.masterUrlOverride, wsPortOverride: ha.wsPortOverride };
      const ex = hid.startsWith('dry:') ? null : await tx.hostApp.findUnique({ where: { hostId_appId: { hostId: hid, appId: ha.appId } } });
      if (ex) {
        if (!same(data, ex as unknown as Record<string, unknown>)) {
          r.hostApps.updated++;
          if (!dryRun) await tx.hostApp.update({ where: { id: ex.id }, data });
        }
      } else {
        r.hostApps.created++;
        if (!dryRun) await tx.hostApp.create({ data: { ...data, hostId: hid, appId: ha.appId } });
      }
    }

    for (const ro of plan.roles) {
      const hid = hostId.get(ro.agentUrl)!;
      const data = { enabled: ro.enabled, minOnline: ro.minOnline, idleTimeoutMin: ro.idleTimeoutMin, modelOverride: ro.modelOverride, runtime: ro.runtime };
      const ex = hid.startsWith('dry:') ? null : await tx.roleAssignment.findUnique({ where: { hostId_appId_mode: { hostId: hid, appId: ro.appId, mode: ro.mode } } });
      if (ex) {
        if (!same(data, ex as unknown as Record<string, unknown>)) {
          r.roles.updated++;
          if (!dryRun) await tx.roleAssignment.update({ where: { id: ex.id }, data });
        }
      } else {
        r.roles.created++;
        if (!dryRun) await tx.roleAssignment.create({ data: { ...data, hostId: hid, appId: ro.appId, mode: ro.mode } });
      }
    }
  };

  if (dryRun) await run(db);
  else await db.$transaction(async (tx) => run(tx as unknown as PrismaClient), { timeout: 60_000 });
  await db.importRun.create({ data: { source: s.source, dryRun, report: JSON.stringify(r) } });
  return r;
}
