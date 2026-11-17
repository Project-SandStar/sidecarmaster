/**
 * Task 3.1: App registry. Apps and their modes (role types), with per-mode port, image, env and models.
 * Every write bumps policyRev on the hosts it touches, so the reconcile loop pushes new config.
 */
import { prisma } from '../db';
import { APP_SEEDS, MODE_SEEDS, OLD_OLLAMA_RT, RUNTIMES, modeSeedRow, type HostOs } from '../apps/catalog';
import { encryptSecret, secretHint, decryptSecret } from '../crypto';
import { ControlError, int, str } from './errors';

const ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
const OS_KINDS: HostOs[] = ['linux', 'mac-docker-ollama', 'windows-docker-wsl2'];
const KINDS = ['ollama', 'vllm', 'utility'];
const PROTOCOLS = ['sidecar-v1', 'none'];

const jsonArr = (s: string): string[] => { try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
const jsonObj = (s: string): Record<string, string> => { try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };

/** Seed missing apps and modes. Never changes rows that exist (the operator owns them). */
export async function seedRegistry(): Promise<{ apps: number; modes: number }> {
  let apps = 0, modes = 0;
  for (const a of APP_SEEDS) {
    if (!(await prisma.app.findUnique({ where: { id: a.id } }))) { await prisma.app.create({ data: a }); apps++; }
  }
  for (const m of MODE_SEEDS) {
    if (!(await prisma.appMode.findUnique({ where: { appId_name: { appId: m.appId, name: m.name } } }))) {
      await prisma.appMode.create({ data: modeSeedRow(m) }); modes++;
    }
  }
  modes += await repairModes();
  return { apps, modes };
}

/**
 * Fill seed fields an existing mode row lacks (rows created without port, image, kind or runtimes,
 * or with the old Ollama runtime list). Never overwrites a value the operator set.
 */
export async function repairModes(): Promise<number> {
  let n = 0;
  const old = JSON.stringify(OLD_OLLAMA_RT);
  for (const m of MODE_SEEDS) {
    const row = await prisma.appMode.findUnique({ where: { appId_name: { appId: m.appId, name: m.name } } });
    if (!row) continue;
    const seed = modeSeedRow(m);
    const d: Record<string, unknown> = {};
    const bare = row.port == null && row.image == null;
    if (row.port == null) d.port = seed.port;
    if (row.image == null) d.image = seed.image;
    if (row.vramMb == null) d.vramMb = seed.vramMb;
    if (bare && row.kind !== seed.kind) d.kind = seed.kind;
    if (row.runtimes === '[]' || row.runtimes === old) d.runtimes = seed.runtimes;
    if (row.defaultModels === '{}' && seed.defaultModels !== '{}') { d.defaultModels = seed.defaultModels; d.defaultModel = row.defaultModel ?? seed.defaultModel; }
    if (bare && row.requiresGpu !== seed.requiresGpu) d.requiresGpu = seed.requiresGpu;
    if (Object.keys(d).length) { await prisma.appMode.update({ where: { id: row.id }, data: d }); n++; }
  }
  return n;
}

export interface AppView {
  id: string; displayName: string; masterUrl: string | null; wsUrl: string | null; protocol: string; enabled: boolean;
  probeUrl: string | null; apiScopes: string[]; apiTokenHint: string | null; apiTokenAt: Date | null;
  sidecarTokenHint: string | null; modeCount: number; hostCount: number;
}

type AppRow = Awaited<ReturnType<typeof prisma.app.findMany>>[number];
function appView(a: AppRow, modeCount = 0, hostCount = 0): AppView {
  let sidecarTokenHint: string | null = null;
  if (a.sidecarTokenEnc) { try { sidecarTokenHint = secretHint(decryptSecret(a.sidecarTokenEnc)); } catch { sidecarTokenHint = '?'; } }
  return {
    id: a.id, displayName: a.displayName, masterUrl: a.masterUrl, wsUrl: a.wsUrl, protocol: a.protocol, enabled: a.enabled,
    probeUrl: a.probeUrl, apiScopes: jsonArr(a.apiScopes), apiTokenHint: a.apiTokenHint, apiTokenAt: a.apiTokenAt,
    sidecarTokenHint, modeCount, hostCount,
  };
}

export async function listApps(): Promise<AppView[]> {
  const rows = await prisma.app.findMany({ orderBy: { id: 'asc' }, include: { _count: { select: { modes: true, hosts: true } } } });
  return rows.map((a) => appView(a, a._count.modes, a._count.hosts));
}

export async function getApp(id: string): Promise<AppView | null> {
  const a = await prisma.app.findUnique({ where: { id }, include: { _count: { select: { modes: true, hosts: true } } } });
  return a ? appView(a, a._count.modes, a._count.hosts) : null;
}

const url = (v: unknown, name: string) => {
  const s = str(v, name, true);
  if (s && !/^(https?|wss?):\/\/\S+$/.test(s)) throw new ControlError(`${name} must be an http(s) or ws(s) URL`);
  return s;
};

function appFields(b: Record<string, unknown>, partial: boolean) {
  const d: Record<string, unknown> = {};
  if (!partial || b.displayName !== undefined) d.displayName = str(b.displayName, 'displayName');
  if (b.masterUrl !== undefined) d.masterUrl = url(b.masterUrl, 'masterUrl');
  if (b.wsUrl !== undefined) d.wsUrl = url(b.wsUrl, 'wsUrl');
  if (b.probeUrl !== undefined) d.probeUrl = url(b.probeUrl, 'probeUrl');
  if (b.protocol !== undefined) {
    if (!PROTOCOLS.includes(String(b.protocol))) throw new ControlError(`protocol must be one of ${PROTOCOLS.join(', ')}`);
    d.protocol = b.protocol;
  }
  if (b.enabled !== undefined) d.enabled = b.enabled === true;
  if (b.sidecarToken !== undefined) {
    const t = str(b.sidecarToken, 'sidecarToken', true);
    d.sidecarTokenEnc = t ? encryptSecret(t) : null;
  }
  return d;
}

export async function createApp(b: Record<string, unknown>): Promise<AppView> {
  const id = str(b.id, 'id')!;
  if (!ID_RE.test(id)) throw new ControlError('id: lower-case letters, digits and "-", 2–40 characters, starts with a letter');
  if (await prisma.app.findUnique({ where: { id } })) throw new ControlError(`App "${id}" exists`, 409);
  const a = await prisma.app.create({ data: { id, ...(appFields(b, false) as { displayName: string }) } });
  return appView(a);
}

export async function updateApp(id: string, b: Record<string, unknown>): Promise<AppView> {
  if (!(await prisma.app.findUnique({ where: { id } }))) throw new ControlError(`No app "${id}"`, 404);
  await prisma.app.update({ where: { id }, data: appFields(b, true) });
  await bumpHosts({ appId: id });
  return (await getApp(id))!;
}

export async function deleteApp(id: string): Promise<void> {
  if (!(await prisma.app.findUnique({ where: { id } }))) throw new ControlError(`No app "${id}"`, 404);
  const n = await prisma.roleAssignment.count({ where: { appId: id, enabled: true } });
  if (n > 0) throw new ControlError(`App "${id}" has ${n} enabled role(s). Disable them first.`, 409);
  await bumpHosts({ appId: id });
  await prisma.app.delete({ where: { id } });
}

/** The sidecar token in plain text, for the config push only. Never returned by an API. */
export async function sidecarTokenFor(appId: string): Promise<string | null> {
  const a = await prisma.app.findUnique({ where: { id: appId }, select: { sidecarTokenEnc: true } });
  if (!a?.sidecarTokenEnc) return null;
  try { return decryptSecret(a.sidecarTokenEnc); } catch { return null; }
}

// ─── Modes ────────────────────────────────────────────────────────────────

export interface ModeView {
  id: string; appId: string; name: string; label: string | null; description: string | null;
  kind: string; image: string | null; port: number | null; vramMb: number | null; requiresGpu: boolean;
  availableOn: HostOs[]; runtimes: string[]; env: Record<string, string>; defaultModel: string | null;
  defaultModels: Record<string, string>;
}

type ModeRow = Awaited<ReturnType<typeof prisma.appMode.findMany>>[number];
export function modeView(m: ModeRow): ModeView {
  return {
    id: m.id, appId: m.appId, name: m.name, label: m.label, description: m.description, kind: m.kind, image: m.image,
    port: m.port, vramMb: m.vramMb, requiresGpu: m.requiresGpu, availableOn: jsonArr(m.availableOn) as HostOs[],
    runtimes: jsonArr(m.runtimes), env: jsonObj(m.env), defaultModel: m.defaultModel, defaultModels: jsonObj(m.defaultModels),
  };
}

export async function listModeViews(appId?: string): Promise<ModeView[]> {
  const rows = await prisma.appMode.findMany({ where: appId ? { appId } : {}, orderBy: [{ appId: 'asc' }, { name: 'asc' }] });
  return rows.map(modeView);
}

/** Model for a mode on an OS: per-OS default, then `default`, then defaultModel. */
export function modelFor(m: ModeView, os: HostOs | null): string | null {
  return (os && m.defaultModels[os]) || m.defaultModels.default || m.defaultModel || null;
}

function strMap(v: unknown, name: string): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ControlError(`${name} must be an object of text values`);
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x !== 'string') throw new ControlError(`${name}.${k} must be text`);
    out[k] = x;
  }
  return out;
}

function modeFields(b: Record<string, unknown>, partial: boolean) {
  const d: Record<string, unknown> = {};
  const has = (k: string) => !partial || b[k] !== undefined;
  if (b.label !== undefined) d.label = str(b.label, 'label', true);
  if (b.description !== undefined) d.description = str(b.description, 'description', true);
  if (has('kind')) {
    const k = b.kind ?? 'ollama';
    if (!KINDS.includes(String(k))) throw new ControlError(`kind must be one of ${KINDS.join(', ')}`);
    d.kind = k;
  }
  if (b.image !== undefined) d.image = str(b.image, 'image', true);
  if (has('port')) d.port = int(b.port, 'port', 1, 65535, true);
  if (b.vramMb !== undefined) d.vramMb = int(b.vramMb, 'vramMb', 0, 1_000_000, true);
  if (b.requiresGpu !== undefined) d.requiresGpu = b.requiresGpu === true;
  if (b.availableOn !== undefined) {
    if (!Array.isArray(b.availableOn) || b.availableOn.some((o) => !OS_KINDS.includes(o as HostOs))) throw new ControlError(`availableOn: list of ${OS_KINDS.join(', ')}`);
    d.availableOn = JSON.stringify(b.availableOn);
  }
  if (b.runtimes !== undefined) {
    if (!Array.isArray(b.runtimes) || b.runtimes.some((r) => !(RUNTIMES as readonly string[]).includes(r as string))) throw new ControlError(`runtimes: list of ${RUNTIMES.join(', ')}`);
    d.runtimes = JSON.stringify(b.runtimes);
  }
  if (b.env !== undefined) d.env = JSON.stringify(strMap(b.env, 'env'));
  if (b.defaultModels !== undefined) {
    const dm = strMap(b.defaultModels, 'defaultModels');
    for (const k of Object.keys(dm)) if (k !== 'default' && !OS_KINDS.includes(k as HostOs)) throw new ControlError(`defaultModels: unknown OS "${k}"`);
    d.defaultModels = JSON.stringify(dm);
    d.defaultModel = dm.default ?? null;
  }
  return d;
}

/** Two modes on the same port clash when a host may run both (shared OS). Host-runtime and DMR share ports on purpose. */
async function checkPortClash(appId: string, name: string, port: number | null | undefined, availableOn: string[]) {
  if (!port) return;
  const others = await prisma.appMode.findMany({ where: { port, NOT: { appId, name } } });
  for (const o of others) {
    const os = jsonArr(o.availableOn);
    if (os.length === 0 || availableOn.length === 0 || os.some((x) => availableOn.includes(x))) {
      throw new ControlError(`Port ${port} is used by ${o.appId}/${o.name}`, 409);
    }
  }
}

export async function createMode(appId: string, b: Record<string, unknown>): Promise<ModeView> {
  if (!(await prisma.app.findUnique({ where: { id: appId } }))) throw new ControlError(`No app "${appId}"`, 404);
  const name = str(b.name, 'name')!;
  if (!ID_RE.test(name)) throw new ControlError('name: lower-case letters, digits and "-", 2–40 characters');
  if (await prisma.appMode.findFirst({ where: { name } })) throw new ControlError(`Mode "${name}" exists`, 409);
  const d = modeFields(b, false);
  if (!d.availableOn) d.availableOn = JSON.stringify(OS_KINDS);
  if (!d.runtimes) d.runtimes = JSON.stringify(d.kind === 'vllm' ? ['docker-vllm'] : d.kind === 'utility' ? ['docker-cpu'] : ['docker-ollama']);
  await checkPortClash(appId, name, d.port as number | null, jsonArr(d.availableOn as string));
  return modeView(await prisma.appMode.create({ data: { appId, name, ...d } }));
}

export async function updateMode(appId: string, name: string, b: Record<string, unknown>): Promise<ModeView> {
  const ex = await prisma.appMode.findUnique({ where: { appId_name: { appId, name } } });
  if (!ex) throw new ControlError(`No mode ${appId}/${name}`, 404);
  const d = modeFields(b, true);
  const port = d.port !== undefined ? (d.port as number | null) : ex.port;
  await checkPortClash(appId, name, port, jsonArr((d.availableOn as string | undefined) ?? ex.availableOn));
  const m = await prisma.appMode.update({ where: { id: ex.id }, data: d });
  await bumpHosts({ appId, mode: name });
  return modeView(m);
}

export async function deleteMode(appId: string, name: string): Promise<void> {
  const ex = await prisma.appMode.findUnique({ where: { appId_name: { appId, name } } });
  if (!ex) throw new ControlError(`No mode ${appId}/${name}`, 404);
  const n = await prisma.roleAssignment.count({ where: { appId, mode: name, enabled: true } });
  if (n > 0) throw new ControlError(`Mode ${name} is enabled on ${n} host(s). Disable it first.`, 409);
  await prisma.appMode.delete({ where: { id: ex.id } });
}

/** Mark hosts as needing a new config push. */
export async function bumpHosts(where: { hostId?: string; appId?: string; mode?: string }): Promise<number> {
  let ids: string[];
  if (where.hostId) ids = [where.hostId];
  else {
    const rows = await prisma.roleAssignment.findMany({ where: { appId: where.appId, mode: where.mode }, select: { hostId: true }, distinct: ['hostId'] });
    const ha = where.appId && !where.mode ? await prisma.hostApp.findMany({ where: { appId: where.appId }, select: { hostId: true } }) : [];
    ids = [...new Set([...rows, ...ha].map((r) => r.hostId))];
  }
  if (ids.length === 0) return 0;
  const r = await prisma.host.updateMany({ where: { id: { in: ids } }, data: { policyRev: { increment: 1 } } });
  return r.count;
}
