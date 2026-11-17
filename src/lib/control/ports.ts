/**
 * Ports and runtimes per role. Ported from court-lens-mcp src/components/admin-role-assignments.tsx
 * (portForRuntime, reportedPortFor, defaultRuntimeForRow), made generic for every app's modes.
 */
import { MODE_SEEDS, type HostOs, type RuntimeChoice } from '../apps/catalog';
import type { ContainerLive } from '../fleet/interfaces';

export const HOST_OLLAMA_PORT = 11434; // SS_HOST_OLLAMA_PORT
export const DMR_PORT = 12434; // SS_DMR_PORT

const SEED_PORTS: Record<string, number> = Object.fromEntries(MODE_SEEDS.map((m) => [m.name, m.port]));

export interface ModeLike { name: string; kind: string; runtimes: string[] }

/** Seed mode by name, for callers that only know the name. */
export function seedMode(name: string): ModeLike | undefined {
  const m = MODE_SEEDS.find((x) => x.name === name);
  return m && { name: m.name, kind: m.kind, runtimes: m.runtimes };
}

/**
 * The port a role binds under a runtime. The port is a function of (role, runtime):
 * native Ollama is one listener shared by every host-runtime role; DMR is one endpoint.
 */
export function portForRuntime(mode: string, runtime: RuntimeChoice | string | null, ports: Record<string, number | null | undefined> = SEED_PORTS): number | undefined {
  if (runtime === 'host') return HOST_OLLAMA_PORT;
  if (runtime === 'docker-model-runner') return DMR_PORT;
  return ports[mode] ?? undefined;
}

/** Key the sidecar uses for a role: Sound Suite drops `ss-`; other apps keep the mode name. */
export function roleKey(appId: string, mode: string): string {
  return appId === 'soundsuite' ? mode.replace(/^ss-/, '') : mode;
}

/**
 * The port the sidecar reported for this role, or undefined. Only trusted when the reported
 * runtime matches the selected one (image 'host-ollama' / 'dmr' mark assumed, not probed, status).
 */
export function reportedPortFor(containers: ContainerLive[] | undefined, appId: string, mode: string, selected: RuntimeChoice | string | null): number | undefined {
  const c = containers?.find((x) => x.role === roleKey(appId, mode));
  const port = c?.port;
  if (typeof port !== 'number' || !Number.isFinite(port) || port <= 0) return undefined;
  if (c?.image === 'host-ollama') return selected === 'host' ? port : undefined;
  if (c?.image === 'dmr' || c?.image === 'docker-model-runner') return selected === 'docker-model-runner' ? port : undefined;
  return selected === 'docker-ollama' || selected === 'docker-vllm' || selected === 'docker-cpu' ? port : undefined;
}

/** Default runtime when a row has none. Modes with one runtime never vary by OS. */
export function defaultRuntimeForRow(mode: ModeLike | string, os: HostOs | string | null | undefined): RuntimeChoice {
  const m = typeof mode === 'string' ? seedMode(mode) ?? { name: mode, kind: 'ollama', runtimes: [] } : mode;
  if (m.runtimes.length === 1) return m.runtimes[0] as RuntimeChoice;
  if (m.kind === 'utility') return 'docker-cpu';
  if (m.name === 'ss-reranker') return 'docker-vllm';
  if (m.kind === 'vllm') return os === 'mac-docker-ollama' ? 'docker-model-runner' : 'docker-vllm';
  if (os === 'mac-docker-ollama') return 'host';
  return 'docker-ollama';
}

/** Runtime labels, in Sound Suite's column order (RUNTIME_COLUMNS). */
export const RUNTIME_LABELS: { key: RuntimeChoice; label: string }[] = [
  { key: 'host', label: 'Ollama (native)' },
  { key: 'docker-ollama', label: 'Docker Ollama' },
  { key: 'docker-vllm', label: 'Docker vLLM' },
  { key: 'docker-model-runner', label: 'Docker Model Runner' },
  { key: 'docker-cpu', label: 'Docker (no GPU)' },
];

/**
 * Per-OS runtime availability (Sound Suite availableRuntimesForOs).
 * Mac: Docker Desktop has no GPU passthrough, so no docker-ollama / docker-vllm; native Ollama and DMR instead.
 * Windows: Docker via WSL2 with NVIDIA; no native Ollama. Linux and unknown OS: everything.
 */
export function availableRuntimesForOs(os: HostOs | string | null | undefined): RuntimeChoice[] {
  if (os === 'mac-docker-ollama') return ['host', 'docker-model-runner', 'docker-cpu'];
  if (os === 'windows-docker-wsl2') return ['docker-ollama', 'docker-vllm', 'docker-model-runner', 'docker-cpu'];
  return ['host', 'docker-ollama', 'docker-vllm', 'docker-model-runner', 'docker-cpu'];
}

/** Why a runtime cannot run a mode on an OS, or null when it can (Sound Suite cell tooltips). */
export function runtimeBlockReason(mode: ModeLike, os: HostOs | string | null | undefined, rt: RuntimeChoice | string): string | null {
  if (mode.runtimes.length && !mode.runtimes.includes(rt)) return `${mode.name} cannot run on ${rt}`;
  if (!availableRuntimesForOs(os).includes(rt as RuntimeChoice)) {
    return os === 'mac-docker-ollama' ? 'Mac Docker Desktop has no GPU passthrough' : 'Not available on this host';
  }
  return null;
}

/**
 * The runtime a row runs under: modes with one runtime read through the pin (Sound Suite PINNED_RUNTIME),
 * then the stored value, then the OS default.
 */
export function effectiveRuntime(mode: ModeLike, stored: string | null | undefined, os: HostOs | string | null | undefined): RuntimeChoice {
  if (mode.runtimes.length === 1) return mode.runtimes[0] as RuntimeChoice;
  return (stored as RuntimeChoice | null) ?? defaultRuntimeForRow(mode, os);
}

/**
 * Host OS kind (Sound Suite inferOs): admin override, then the OS the sidecar reports, then a guess
 * from the hostname (".local" or "mac" = Mac, "win"/"wsl" = Windows). Null when nothing is known.
 */
export function inferHostOs(override: string | null | undefined, declared: string | null | undefined, hostname: string | null | undefined): HostOs | null {
  const o = hostOsKind(override) ?? hostOsKind(declared === 'win32' ? 'windows' : declared);
  if (o) return o;
  const h = (hostname ?? '').toLowerCase();
  if (!h) return null;
  if (h.includes('mac') || h.endsWith('.local')) return 'mac-docker-ollama';
  if (h.includes('win') || h.includes('wsl')) return 'windows-docker-wsl2';
  return 'linux';
}

/** Normalise a host OS value (override or reported) to a mode-catalog OS kind. */
export function hostOsKind(v: string | null | undefined): HostOs | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (s === 'linux' || s === 'mac-docker-ollama' || s === 'windows-docker-wsl2') return s;
  if (s.startsWith('mac') || s === 'darwin') return 'mac-docker-ollama';
  if (s.startsWith('win')) return 'windows-docker-wsl2';
  if (s.startsWith('linux') || s === 'ubuntu') return 'linux';
  return null;
}
