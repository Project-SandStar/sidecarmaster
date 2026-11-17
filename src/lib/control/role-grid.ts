/**
 * Role assignment grid: which runtime cells a host can use, their tooltips, host OS choice,
 * GPU badge, loaded models and "Reset to defaults". Pure functions (no DB), ported from
 * court-lens-mcp src/components/admin-role-assignments.tsx so the page and the tests share them.
 */
import type { HostOs, RuntimeChoice } from '../apps/catalog';
import type { ContainerLive, GpuLive } from '../fleet/interfaces';
import { RUNTIME_LABELS, availableRuntimesForOs, defaultRuntimeForRow, hostOsKind } from './ports';

export interface GridMode { appId: string; name: string; kind: string; runtimes: string[]; availableOn: string[] }

export const OS_LABEL: Record<HostOs, string> = {
  'mac-docker-ollama': 'Mac Docker (Ollama)', 'windows-docker-wsl2': 'Windows Docker (WSL2)', linux: 'Linux',
};
export const osLabel = (os: string | null | undefined) => (os && OS_LABEL[os as HostOs]) || 'Unknown';

const labelOf = (rt: string) => RUNTIME_LABELS.find((x) => x.key === rt)?.label ?? rt;

/** The mode can run on this OS at all (catalog availableOn). Unknown OS: yes. */
export function modeAvailableOn(m: GridMode, os: HostOs | null): boolean {
  return !os || !m.availableOn.length || m.availableOn.includes(os);
}

/** Why a mode's whole row is greyed out on this OS (Sound Suite unavailableReason). */
export function unavailableReason(modeName: string, os: HostOs | null): string {
  const o = osLabel(os);
  switch (modeName) {
    case 'ss-reranker':
      return `ss-reranker is not supported on ${o}: vllm-metal lacks cross-encoder support. Use a Linux or Windows sidecar with NVIDIA for reranking.`;
    case 'ss-rlm':
      return `ss-rlm is not supported on ${o}: no MLX conversion of the RLM fine-tune is published, so vllm-metal cannot load it. Use a Linux or Windows sidecar with NVIDIA, or enable ss-rlm-sandbox instead.`;
    default:
      return `${modeName} is not supported on ${o}.`;
  }
}

/** Why the host OS cannot use a runtime, or null when it can. */
export function osBlockReason(os: HostOs | null, rt: string): string | null {
  if (availableRuntimesForOs(os).includes(rt as RuntimeChoice)) return null;
  if (os === 'mac-docker-ollama') return 'Mac Docker Desktop has no GPU passthrough for plain Ollama/vLLM containers. Use native Ollama (or DMR / vllm-metal).';
  if (os === 'windows-docker-wsl2') return 'Windows hosts run Ollama in Docker (WSL2). Native Ollama on Windows is not supported.';
  return 'Not available on this host.';
}

export interface GridCell { key: RuntimeChoice; label: string; available: boolean; tooltip: string }

/** One radio cell: can the mode run under this runtime on this OS, and the tooltip that says why. */
export function gridCell(m: GridMode, os: HostOs | null, rt: RuntimeChoice): GridCell {
  const label = labelOf(rt);
  const allowed = !m.runtimes.length || m.runtimes.includes(rt);
  const osBlock = osBlockReason(os, rt);
  const onOs = modeAvailableOn(m, os);
  let tooltip: string;
  if (!onOs) tooltip = unavailableReason(m.name, os);
  else if (!allowed) tooltip = `${m.name} cannot run on ${label}.`;
  else if (osBlock) tooltip = osBlock;
  else if (rt === 'docker-model-runner' && m.kind !== 'vllm') {
    tooltip = `Run ${m.name} via ${label}. Note: sidecar DMR support for ${m.name} is pending; the model override saves but the container will not start until that ships.`;
  } else if (rt === 'docker-cpu') tooltip = `Run ${m.name} via ${label} (no GPU needed).`;
  else tooltip = `Run ${m.name} via ${label}`;
  return { key: rt, label, available: onOs && allowed && !osBlock, tooltip };
}

export function gridCells(m: GridMode, os: HostOs | null): GridCell[] {
  return RUNTIME_LABELS.map((x) => gridCell(m, os, x.key));
}

export interface GridColumn { key: RuntimeChoice; label: string; available: boolean; title: string }

/** Column headers: greyed when no role on this host can use the runtime on its OS. */
export function gridColumns(modes: GridMode[], os: HostOs | null): GridColumn[] {
  return RUNTIME_LABELS.map(({ key, label }) => {
    const osBlock = osBlockReason(os, key);
    const used = modes.some((m) => gridCell(m, os, key).available);
    const title = osBlock ?? (used ? label : `No role here can use ${label} on ${osLabel(os)}.`);
    return { key, label, available: !osBlock && used, title };
  });
}

/** Port column tooltip and the shared-port marker (native Ollama and DMR serve every role on one port). */
export function portNote(runtime: string, reported: boolean, hostName: string): { shared: boolean; title: string } {
  const shared = runtime === 'host' || runtime === 'docker-model-runner';
  const base = reported ? `Reported by ${hostName}.` : 'Default for the selected runtime; overridable per host.';
  const extra = runtime === 'host'
    ? ' One native Ollama serves every host role on this single port; roles are told apart by model, not by port.'
    : runtime === 'docker-model-runner' ? ' Docker Model Runner serves every role from this single endpoint.' : '';
  return { shared, title: base + extra };
}

function guessOs(hostname: string | null | undefined): HostOs | null {
  const h = (hostname ?? '').toLowerCase();
  if (!h) return null;
  if (h.includes('mac') || h.endsWith('.local')) return 'mac-docker-ollama';
  if (h.includes('win') || h.includes('wsl')) return 'windows-docker-wsl2';
  return 'linux';
}

export interface HostOsInfo {
  os: HostOs | null;
  source: 'reported' | 'override' | 'guessed' | null;
  reported: HostOs | null;
  override: HostOs | null;
  /** Tooltip: where the OS came from, and why Sound Suite may show another value. */
  title: string;
}

/**
 * Host OS for the grid. The OS the sidecar reports wins; the manual override (Host provisioning)
 * is used when the sidecar reports none; else a guess from the hostname (Sound Suite inferOs).
 */
export function resolveHostOs(override: string | null | undefined, reported: string | null | undefined, hostname: string | null | undefined): HostOsInfo {
  const r = hostOsKind(reported);
  const o = hostOsKind(override);
  const g = guessOs(hostname);
  if (r) {
    const title = o && o !== r
      ? `The sidecar reports ${osLabel(r)}. The manual override (${osLabel(o)}) is ignored while the sidecar reports an OS.`
      : `The sidecar reports ${osLabel(r)}.`;
    return { os: r, source: 'reported', reported: r, override: o, title };
  }
  if (o) {
    const ss = g && g !== o ? ` Sound Suite may show "${osLabel(g)}" here: it guesses from the hostname when its override is stored under another URL.` : '';
    return { os: o, source: 'override', reported: null, override: o, title: `The sidecar reports no OS. Using the manual override from Host provisioning.${ss}` };
  }
  if (g) return { os: g, source: 'guessed', reported: null, override: null, title: `The sidecar reports no OS and there is no override. Guessed "${osLabel(g)}" from the hostname.` };
  return { os: null, source: null, reported: null, override: null, title: 'OS unknown: every runtime is allowed.' };
}

/** GPU badge, e.g. "RTX A6000 48 GB" (first GPU, "NVIDIA " cut). */
export function gpuSummary(gpus: GpuLive[] | undefined): string | null {
  const g = gpus?.[0];
  if (!g) return null;
  const name = (g.name || 'GPU').replace(/^NVIDIA\s+/i, '');
  return g.memoryTotalMb ? `${name} ${Math.round(g.memoryTotalMb / 1024)} GB` : name;
}

/** Models loaded on the host, deduplicated across containers (native Ollama shows the same list to every role). */
export function loadedModels(containers: ContainerLive[] | undefined): { name: string; size: number | null }[] {
  const seen = new Set<string>();
  const out: { name: string; size: number | null }[] = [];
  for (const c of containers ?? []) {
    for (const m of c.loadedModels ?? []) {
      if (!m.name || seen.has(m.name)) continue;
      seen.add(m.name);
      out.push({ name: m.name, size: m.size ?? null });
    }
  }
  return out;
}

/** Sound Suite RESET_DEFAULTS; other modes get minOnline 0, idle 5. */
export const RESET_DEFAULTS: Record<string, { minOnline: number; idleTimeoutMin: number }> = {
  'ss-embedding': { minOnline: 1, idleTimeoutMin: 0 },
  'ss-code-embedding': { minOnline: 0, idleTimeoutMin: 5 },
  'ss-completion': { minOnline: 1, idleTimeoutMin: 10 },
  'ss-ocr': { minOnline: 1, idleTimeoutMin: 5 },
  'ss-reranker': { minOnline: 0, idleTimeoutMin: 5 },
  'ss-rlm': { minOnline: 0, idleTimeoutMin: 10 },
  'ss-rlm-sandbox': { minOnline: 1, idleTimeoutMin: 0 },
};

export interface ResetItem { appId: string; mode: string; enabled: boolean; minOnline: number; idleTimeoutMin: number; runtime: RuntimeChoice }

/** "Reset to defaults": every mode the OS can run is on with its OS default runtime; the rest are removed. */
export function resetPlan(modes: GridMode[], os: HostOs | null): ResetItem[] {
  return modes.map((m) => {
    const d = RESET_DEFAULTS[m.name] ?? { minOnline: 0, idleTimeoutMin: 5 };
    return { appId: m.appId, mode: m.name, enabled: modeAvailableOn(m, os), ...d, runtime: defaultRuntimeForRow(m, os) };
  });
}

