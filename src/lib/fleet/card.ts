/**
 * Host card data for the Hosts page (Sound Suite "GPU Fleet" look).
 *
 * Pure functions: a sidecar heartbeat (statusData) plus the role rows from the DB go in,
 * the chips, labels and Tailwind classes the card draws come out. No DB, no React, no browser
 * API, so the page, the SSE route, the host detail page and the tests share one mapping.
 *
 * Colours follow court-lens-mcp src/components/admin-gpu-fleet.tsx:
 *   container running = green, provisioned but stopped = orange, not provisioned = yellow,
 *   created but never started = slate, WS = purple, HTTP = blue, offline = red, never seen = grey.
 */
import type { SidecarStatusData } from '../protocol';

// ─── Host OS ──────────────────────────────────────────────────────────────
export type HostOsKind = 'linux' | 'mac-docker-ollama' | 'windows-docker-wsl2';
export const OS_LABELS: Record<HostOsKind, string> = {
  linux: 'Linux', 'mac-docker-ollama': 'Mac Docker (Ollama)', 'windows-docker-wsl2': 'Windows Docker (WSL2)',
};
export interface HostOsView { kind: HostOsKind | null; label: string; source: 'reported' | 'override' | 'guessed' | null; title: string }

export function osKind(v: string | null | undefined): HostOsKind | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (s === 'linux' || s === 'mac-docker-ollama' || s === 'windows-docker-wsl2') return s;
  if (s.startsWith('mac') || s === 'darwin') return 'mac-docker-ollama';
  if (s.startsWith('win')) return 'windows-docker-wsl2';
  if (s.startsWith('linux') || s === 'ubuntu') return 'linux';
  return null;
}

function guessOs(hostname: string | null | undefined): HostOsKind | null {
  const h = (hostname ?? '').toLowerCase();
  if (!h) return null;
  if (h.includes('mac') || h.endsWith('.local')) return 'mac-docker-ollama';
  if (h.includes('win') || h.includes('wsl')) return 'windows-docker-wsl2';
  return 'linux';
}

/** The OS the sidecar reports wins; then the manual override; then a guess from the hostname. */
export function resolveOs(override: string | null | undefined, reported: string | null | undefined, hostname: string | null | undefined): HostOsView {
  const r = osKind(reported), o = osKind(override), g = guessOs(hostname);
  if (r) {
    const ignored = o && o !== r ? ` The manual override (${OS_LABELS[o]}) is ignored.` : '';
    return { kind: r, label: OS_LABELS[r], source: 'reported', title: `The sidecar reports ${OS_LABELS[r]}.${ignored}` };
  }
  if (o) return { kind: o, label: OS_LABELS[o], source: 'override', title: 'Manual override from Host provisioning. The sidecar reports no OS.' };
  if (g) return { kind: g, label: OS_LABELS[g], source: 'guessed', title: `Guessed from the hostname "${hostname}". The sidecar reports no OS.` };
  return { kind: null, label: 'OS unknown', source: null, title: 'The sidecar reports no OS and there is no override.' };
}

/** OS from a heartbeat: statusData.host.os, else statusData.os. */
export function reportedOsOf(d: SidecarStatusData | null | undefined): string | null {
  if (!d) return null;
  const host = d.host && typeof d.host === 'object' ? (d.host as Record<string, unknown>) : null;
  const v = host?.os ?? d.os;
  return typeof v === 'string' && v ? v : null;
}

// ─── Host connection state ────────────────────────────────────────────────
export type HostState = 'live' | 'http' | 'offline' | 'never';
export interface HostStateView { state: HostState; label: string; cls: string; dot: string; title: string }

export function hostState(r: { connected: boolean; transport: 'ws' | 'http' | null; lastHeartbeatAt: number | null }): HostStateView {
  if (r.connected && r.transport !== 'http') {
    return { state: 'live', label: 'live', cls: 'bg-green-100 text-green-800', dot: 'bg-green-500', title: 'WebSocket open to the sidecarmaster relay.' };
  }
  if (r.connected) {
    return { state: 'http', label: 'connected (HTTP)', cls: 'bg-yellow-100 text-yellow-800', dot: 'bg-yellow-500', title: 'HTTP heartbeats only, no WebSocket.' };
  }
  if (r.lastHeartbeatAt) {
    return { state: 'offline', label: 'offline', cls: 'bg-red-100 text-red-800', dot: 'bg-red-500', title: 'No heartbeat now. The last one is shown.' };
  }
  return { state: 'never', label: 'not seen yet', cls: 'bg-gray-100 text-gray-500', dot: 'bg-gray-300', title: 'Known from the Sound Suite import only. No sidecar has connected to sidecarmaster.' };
}

export interface ChipView { label: string; cls: string; title: string }

/** Transport pill: WS purple, HTTP blue; muted "last: WS" when the host is not connected. */
export function transportChip(connected: boolean, transport: 'ws' | 'http' | null): ChipView {
  const name = transport === 'http' ? 'HTTP' : transport === 'ws' ? 'WS' : '—';
  if (!connected) {
    return { label: transport ? `last: ${name}` : '—', cls: 'bg-gray-100 text-gray-400 border border-gray-200', title: transport ? `Last known transport: ${transport}` : 'Never connected' };
  }
  if (transport === 'http') return { label: 'HTTP', cls: 'bg-blue-100 text-blue-800', title: 'Live transport: HTTP heartbeats' };
  return { label: 'WS', cls: 'bg-purple-100 text-purple-800', title: 'Live transport: WebSocket' };
}

// ─── Container / role state ───────────────────────────────────────────────
export type RoleState = 'running' | 'starting' | 'created' | 'stopped' | 'missing' | 'unknown';
export interface RoleStateView { state: RoleState; label: string; cls: string; dot: string }

const RUNNING = ['running', 'healthy', 'up', 'ready'];
const STARTING = ['starting', 'restarting', 'pulling', 'loading', 'provisioning'];
const MISSING = ['not_found', 'missing', 'not_pulled', 'absent'];

/**
 * Sound Suite ContainerStatusBadge: running (green); exists but not running = provisioned,
 * stopped (orange); not_found = not provisioned (yellow); anything else grey.
 * Docker `created` (made but never started) has its own state: created (slate).
 */
export function roleState(status: string | null | undefined, exists: boolean | null | undefined): RoleStateView {
  const s = (status ?? '').toLowerCase();
  if (RUNNING.includes(s)) return { state: 'running', label: 'running', cls: 'bg-green-100 text-green-800', dot: 'bg-green-500' };
  if (STARTING.includes(s)) return { state: 'starting', label: s, cls: 'bg-blue-100 text-blue-800', dot: 'bg-blue-500' };
  if (s === 'created') return { state: 'created', label: 'created', cls: 'bg-slate-200 text-slate-800', dot: 'bg-slate-500' };
  if (MISSING.includes(s) || exists === false) {
    return { state: 'missing', label: 'not provisioned', cls: 'bg-yellow-100 text-yellow-800', dot: 'bg-yellow-500' };
  }
  if (s === 'exited' || s === 'stopped' || s === 'unloaded' || s === 'idle' || s === 'paused' || s === 'dead' || (exists === true && s)) {
    return { state: 'stopped', label: s === 'exited' || s === 'dead' ? 'stopped' : s, cls: 'bg-orange-100 text-orange-800', dot: 'bg-orange-400' };
  }
  if (!s) return { state: 'unknown', label: 'no data', cls: 'bg-gray-100 text-gray-500', dot: 'bg-gray-300' };
  return { state: 'unknown', label: s, cls: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' };
}

/** Dot colour per role state (chip badge and legend). */
export const ROLE_STATE_DOT: Record<RoleState, string> = {
  running: 'bg-green-500', starting: 'bg-blue-500', created: 'bg-slate-500', stopped: 'bg-orange-400', missing: 'bg-yellow-500', unknown: 'bg-gray-300',
};

/** Legend for the Hosts page, in the order the states are shown. */
export const ROLE_STATE_LEGEND: { state: RoleState; label: string; cls: string; title: string }[] = [
  { state: 'running', label: 'running', cls: 'bg-green-100 text-green-800', title: 'The container runs.' },
  { state: 'starting', label: 'starting', cls: 'bg-blue-100 text-blue-800', title: 'The container starts, restarts, pulls or loads.' },
  { state: 'created', label: 'created', cls: 'bg-slate-200 text-slate-800', title: 'Docker made the container, but it never started.' },
  { state: 'stopped', label: 'stopped', cls: 'bg-orange-100 text-orange-800', title: 'The container is there, but it does not run.' },
  { state: 'missing', label: 'not provisioned', cls: 'bg-yellow-100 text-yellow-800', title: 'The role is assigned, but there is no container on the host.' },
  { state: 'unknown', label: 'no data', cls: 'bg-gray-100 text-gray-500', title: 'The sidecar sends no status for this container.' },
];

// ─── Runtime ──────────────────────────────────────────────────────────────
export type RuntimeLabel = 'Ollama (native)' | 'Docker Ollama' | 'Docker vLLM' | 'Docker Model Runner' | 'Docker (no GPU)' | '—';

/** Runtime a role uses: from the container image first, then from the assignment row. */
export function runtimeLabel(image: string | null | undefined, runtime: string | null | undefined, kind?: string | null): RuntimeLabel {
  if (image === 'host-ollama') return 'Ollama (native)';
  if (image === 'dmr' || image === 'docker-model-runner') return 'Docker Model Runner';
  if (image) {
    if (/(^|\/)vllm/i.test(image)) return 'Docker vLLM';
    if (/(^|\/)ollama/i.test(image)) return 'Docker Ollama';
  }
  if (runtime === 'host') return 'Ollama (native)';
  if (runtime === 'docker-vllm') return 'Docker vLLM';
  if (runtime === 'docker-ollama') return 'Docker Ollama';
  if (runtime === 'docker-model-runner') return 'Docker Model Runner';
  if (runtime === 'docker-cpu') return 'Docker (no GPU)';
  if (kind === 'vllm') return 'Docker vLLM';
  if (kind === 'ollama' && image) return 'Docker Ollama';
  return '—';
}

export function runtimeClass(label: RuntimeLabel): string {
  switch (label) {
    case 'Ollama (native)': return 'bg-slate-50 text-slate-700 border-slate-200';
    case 'Docker Ollama': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'Docker vLLM': return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'Docker Model Runner': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'Docker (no GPU)': return 'bg-gray-50 text-gray-600 border-gray-200';
    default: return 'bg-gray-100 text-gray-500 border-gray-200';
  }
}

/** Port a role uses by default when the sidecar did not report one. */
export function defaultPort(runtime: string | null | undefined): number | null {
  if (runtime === 'host') return 11434;
  if (runtime === 'docker-model-runner') return 12434;
  return null;
}

// ─── GPU ──────────────────────────────────────────────────────────────────
export interface GpuView { index: number; name: string; memoryTotal: number; memoryUsed: number; temperature: number }

export function gpuBarClass(pct: number): string {
  return pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-green-500';
}
export function gpuPct(g: Pick<GpuView, 'memoryTotal' | 'memoryUsed'>): number {
  return g.memoryTotal > 0 ? Math.min(100, Math.round((g.memoryUsed / g.memoryTotal) * 100)) : 0;
}
/** Badge text like Sound Suite: "RTX A6000 48 GB". */
export function gpuBadge(g: Pick<GpuView, 'name' | 'memoryTotal'>): string {
  const name = (g.name || 'GPU').replace(/^NVIDIA\s+/i, '');
  return g.memoryTotal ? `${name} ${Math.round(g.memoryTotal / 1024)} GB` : name;
}

// ─── Formatting ───────────────────────────────────────────────────────────
export function fmtAgo(t: number | null | undefined, now: number): string {
  if (!t) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export function fmtUptime(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return '—';
  const m = Math.floor(sec / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (h < 1) return `${m}m`;
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${d}d ${h % 24}h`;
}
/** Ollama "until" time as a short countdown: "24h", "5m", "now", "forever". */
export function fmtUntil(until: string | null | undefined, now: number): string {
  if (!until) return '';
  const target = Date.parse(until);
  if (Number.isNaN(target)) return until.toLowerCase().includes('forever') ? 'forever' : '';
  const ms = target - now;
  if (ms <= 0) return 'now';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
/** Idle timeout in ms as text: 0 = never. */
export function fmtIdle(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms <= 0) return 'never';
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
}
export const gbOfMb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`;
export const gbOfBytes = (b: number) => `${(b / 1e9).toFixed(1)} GB`;

// ─── Containers from a heartbeat ──────────────────────────────────────────
export interface LoadedModelView { name: string; sizeBytes: number | null; processor: string | null; gpuPercent: number | null; until: string | null }
export interface ContainerView {
  role: string; name: string | null; exists: boolean | null; status: string | null; image: string | null; port: number | null;
  model: string | null; type: string | null; vramMb: number | null; gpuOnly: boolean; gpuReady: boolean | null; loaded: LoadedModelView[]; error: string | null;
}

const str = (x: unknown): string | null => (typeof x === 'string' && x && x !== 'undefined' && x !== 'null' ? x : null);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const bool = (x: unknown): boolean | null => (typeof x === 'boolean' ? x : null);
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

function loadedOf(v: unknown): LoadedModelView[] {
  const arr = Array.isArray(v) ? v : [];
  const out: LoadedModelView[] = [];
  for (const m of arr) {
    if (typeof m === 'string') { if (m) out.push({ name: m, sizeBytes: null, processor: null, gpuPercent: null, until: null }); continue; }
    const o = obj(m);
    const name = str(o.name);
    if (!name) continue;
    out.push({ name, sizeBytes: num(o.sizeVram) ?? num(o.sizeBytes) ?? null, processor: str(o.processor), gpuPercent: num(o.gpuPercent), until: str(o.until) });
  }
  return out;
}

/** Sound Suite sidecars send `containers` as a record keyed by role (or an array; saved state is a list of names). */
export function parseContainers(c: unknown): ContainerView[] {
  const one = (key: string | null, v: unknown): ContainerView => {
    if (typeof v === 'string') {
      return { role: key ?? v, name: v, exists: null, status: null, image: null, port: null, model: null, type: null, vramMb: null, gpuOnly: false, gpuReady: null, loaded: [], error: null };
    }
    const o = obj(v);
    const cfg = obj(o.config);
    const role = key ?? str(o.role) ?? str(o.name) ?? '?';
    const port = num(o.port) ?? num(cfg.port);
    return {
      role, name: str(o.name), exists: bool(o.exists), status: str(o.status) ?? str(o.state), image: str(o.image) ?? str(cfg.image),
      port: port && port > 0 ? port : null, model: str(o.model) ?? str(cfg.model), type: str(o.type) ?? str(cfg.type),
      vramMb: num(o.vram) ?? num(cfg.vram), gpuOnly: cfg.gpuOnly === true, gpuReady: bool(o.gpuReady),
      loaded: loadedOf(o.loadedModels ?? o.models), error: str(o.error) ?? str(o.lastError),
    };
  };
  if (Array.isArray(c)) return c.map((v) => one(null, v));
  if (c && typeof c === 'object') return Object.entries(c as Record<string, unknown>).map(([k, v]) => one(k, v));
  return [];
}

/** Key the sidecar uses for a role: Sound Suite drops `ss-`; other apps keep the mode name. */
export function roleKeyOf(appId: string | null | undefined, mode: string): string {
  return (appId ?? 'soundsuite') === 'soundsuite' ? mode.replace(/^ss-/, '') : mode;
}

// ─── Role chips ───────────────────────────────────────────────────────────
export interface RoleAssignmentRow {
  mode: string; enabled: boolean; appId?: string | null; runtime?: string | null; modelOverride?: string | null;
  idleTimeoutMin?: number | null; minOnline?: number | null;
}

export interface RoleChip {
  /** Sidecar role key, e.g. "ocr". */
  key: string;
  /** Mode name as assigned, e.g. "ss-ocr" (falls back to the role key for live-only containers). */
  mode: string;
  appId: string | null;
  assigned: boolean;
  container: string | null;
  status: string | null;
  state: RoleState; stateLabel: string; stateClass: string;
  runtime: RuntimeLabel; runtimeClass: string;
  image: string | null; port: number | null; model: string | null; type: string | null;
  loaded: LoadedModelView[];
  idleTimeoutMs: number | null; idleTimerActive: boolean | null;
  activeRequests: number | null; gpuReady: boolean | null; gpuOnly: boolean; vramMb: number | null;
  error: string | null;
}

function roleInfoOf(d: SidecarStatusData | null | undefined, key: string): { activeRequests: number | null; idleTimerActive: boolean | null } {
  const r = obj(obj(d?.roles)[key]);
  return { activeRequests: num(r.activeRequests), idleTimerActive: bool(r.idleTimerActive) };
}

/**
 * One chip per role: the enabled assignments from the DB joined with the live containers from the
 * heartbeat on the sidecar role key. Live containers with no assignment are shown too (marked).
 */
export function buildRoleChips(d: SidecarStatusData | null | undefined, assignments: RoleAssignmentRow[]): RoleChip[] {
  const containers = parseContainers(d?.containers);
  const byKey = new Map(containers.map((c) => [c.role, c] as const));
  const byName = new Map(containers.filter((c) => c.name).map((c) => [c.name as string, c] as const));
  const idle = obj(d?.idleTimeouts);
  const used = new Set<string>();
  const usedC = new Set<ContainerView>();
  const chip = (key: string, a: RoleAssignmentRow | null, c: ContainerView | null): RoleChip => {
    const st = roleState(c?.status ?? null, c?.exists ?? (c ? null : false));
    const rt = runtimeLabel(c?.image, a?.runtime, c?.type);
    const info = roleInfoOf(d, key);
    const idleMin = a?.idleTimeoutMin;
    const idleMs = num(idle[key]) ?? (typeof idleMin === 'number' ? idleMin * 60_000 : null);
    return {
      key, mode: a?.mode ?? key, appId: a?.appId ?? null, assigned: !!a, container: c?.name ?? null, status: c?.status ?? null,
      state: c ? st.state : (a ? 'missing' : 'unknown'), stateLabel: c ? st.label : 'not provisioned', stateClass: c ? st.cls : 'bg-yellow-100 text-yellow-800',
      runtime: rt, runtimeClass: runtimeClass(rt), image: c?.image ?? null, port: c?.port ?? defaultPort(a?.runtime), model: c?.model ?? a?.modelOverride ?? null, type: c?.type ?? null,
      loaded: c?.loaded ?? [], idleTimeoutMs: idleMs, idleTimerActive: info.idleTimerActive, activeRequests: info.activeRequests,
      gpuReady: c?.gpuReady ?? null, gpuOnly: c?.gpuOnly ?? false, vramMb: c?.vramMb ?? null, error: c?.error ?? null,
    };
  };
  const out: RoleChip[] = [];
  for (const a of [...assignments].filter((x) => x.enabled).sort((x, y) => x.mode.localeCompare(y.mode))) {
    const key = roleKeyOf(a.appId, a.mode);
    if (used.has(key)) continue;
    used.add(key);
    const c = byKey.get(key) ?? byName.get(a.mode) ?? null;
    if (c) usedC.add(c);
    out.push(chip(key, a, c));
  }
  for (const c of containers) {
    if (usedC.has(c) || used.has(c.role)) continue;
    used.add(c.role); usedC.add(c);
    // A disabled assignment still names the mode and app for a container that is still there.
    const a = assignments.find((x) => roleKeyOf(x.appId, x.mode) === c.role || (c.name && x.mode === c.name)) ?? null;
    out.push({ ...chip(c.role, a, c), assigned: false });
  }
  return out;
}

/**
 * Host card: hide the "not provisioned" chips (no container on this host). The card shows
 * a toggle with the hidden count; the host detail page shows all chips.
 */
export function splitRoleChips(chips: RoleChip[]): { shown: RoleChip[]; hidden: RoleChip[] } {
  const shown: RoleChip[] = [], hidden: RoleChip[] = [];
  for (const c of chips) (c.state === 'missing' ? hidden : shown).push(c);
  return { shown, hidden };
}

/** Toggle text under the chips: "2 assigned roles not running here — show". */
export function hiddenRolesLabel(n: number, open: boolean): string {
  return `${n} assigned ${n === 1 ? 'role' : 'roles'} not running here — ${open ? 'hide' : 'show'}`;
}

/** Errors a heartbeat carries: errors[], lastError, failed tasks, per-container errors. */
export function collectErrors(d: SidecarStatusData | null | undefined): string[] {
  if (!d) return [];
  const out: string[] = [];
  const push = (v: unknown) => { const s = str(v); if (s && !out.includes(s)) out.push(s); };
  if (Array.isArray(d.errors)) d.errors.forEach(push); else push(d.errors);
  push(d.lastError);
  if (Array.isArray(d.tasks)) {
    for (const t of d.tasks) {
      const o = obj(t);
      if (o.status === 'failed') push(`${str(o.label) ?? str(o.type) ?? 'task'} failed${str(o.error) ? `: ${str(o.error)}` : ''}`);
    }
  }
  for (const c of parseContainers(d.containers)) if (c.error) push(`${c.name ?? c.role}: ${c.error}`);
  return out;
}

/** Names of the containers a sidecar reports (from the heartbeat or the saved list). */
export function containerNamesOf(d: SidecarStatusData | null | undefined, fallback: unknown): string[] {
  const fromStatus = parseContainers(d?.containers).map((c) => c.name ?? c.role);
  if (fromStatus.length) return fromStatus;
  if (d && Array.isArray(d.containerNames)) return d.containerNames.filter((x): x is string => typeof x === 'string');
  if (Array.isArray(fallback)) return fallback.filter((x): x is string => typeof x === 'string');
  if (fallback && typeof fallback === 'object') return Object.keys(fallback);
  return [];
}
