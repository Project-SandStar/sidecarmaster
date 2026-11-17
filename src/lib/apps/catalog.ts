/**
 * Seed data for the App registry and role types (AppMode).
 * Sound Suite modes are a copy of court-lens-mcp src/lib/gpu/mode-catalog.ts (MODE_METADATA).
 * Fantom gets its own embedding mode (SPEC §16, decision 7).
 * Master URLs follow configure-sidecar-masters-netbird.sh; spam moves to spam.vpn.example.com + HTTPS (decision).
 */
export type HostOs = 'linux' | 'mac-docker-ollama' | 'windows-docker-wsl2';
const ALL: HostOs[] = ['linux', 'mac-docker-ollama', 'windows-docker-wsl2'];
const NO_MAC: HostOs[] = ['linux', 'windows-docker-wsl2'];

export interface AppSeed {
  id: string; displayName: string; masterUrl: string | null; wsUrl: string | null; protocol: 'sidecar-v1' | 'none';
}

export const APP_SEEDS: AppSeed[] = [
  // Follow mode: sidecars still connect to Sound Suite on WS 3002 (decision).
  { id: 'soundsuite', displayName: 'Sound Suite', masterUrl: 'https://soundsuite.vpn.example.com', wsUrl: 'ws://soundsuite.vpn.example.com:3002/sidecar', protocol: 'sidecar-v1' },
  { id: 'fantom', displayName: 'Fantom MCP', masterUrl: 'https://fantom.vpn.example.com', wsUrl: 'ws://fantom.vpn.example.com:3003/sidecar', protocol: 'sidecar-v1' },
  { id: 'quickbooks', displayName: 'QuickBooks MCP', masterUrl: 'https://qbmcpserver.vpn.example.com', wsUrl: 'ws://qbmcpserver.vpn.example.com:3005/sidecar', protocol: 'sidecar-v1' },
  { id: 'spam', displayName: 'Spam filter', masterUrl: 'https://spam.vpn.example.com', wsUrl: 'ws://spam.vpn.example.com:3004/sidecar', protocol: 'sidecar-v1' },
  { id: 'axon', displayName: 'Axon', masterUrl: 'https://axon.vpn.example.com', wsUrl: null, protocol: 'none' },
  { id: 'expedat', displayName: 'ExpeDat', masterUrl: 'https://expedat.vpn.example.com', wsUrl: null, protocol: 'none' },
];

export type ModeKind = 'ollama' | 'vllm' | 'utility';
export const RUNTIMES = ['docker-ollama', 'docker-vllm', 'docker-cpu', 'host', 'docker-model-runner'] as const;
export type RuntimeChoice = (typeof RUNTIMES)[number];

export interface ModeSeed {
  appId: string; name: string; label: string; description: string; availableOn: HostOs[]; requiresGpu: boolean;
  kind: ModeKind; image: string; port: number; vramMb: number;
  /** Model per OS; `default` for any OS not listed. */
  defaultModels: Partial<Record<HostOs | 'default', string>>;
  runtimes: RuntimeChoice[];
}

const VLLM_IMAGE = 'vllm/vllm-openai:v0.21.0';
const CODE_EMBED_MODEL = 'hf.co/jinaai/jina-code-embeddings-1.5b-GGUF:Q8_0';
/** Sound Suite runtimesForMode: Ollama roles may also run on Docker vLLM and DMR. */
const OLLAMA_RT: RuntimeChoice[] = ['docker-ollama', 'host', 'docker-vllm', 'docker-model-runner'];
/** The Ollama runtime list seeded before docker-vllm was added; repairModes() upgrades it. */
export const OLD_OLLAMA_RT: RuntimeChoice[] = ['docker-ollama', 'host', 'docker-model-runner'];
const VLLM_RT: RuntimeChoice[] = ['docker-vllm', 'docker-model-runner'];

/** Ports, images and models copied from sideCar/src/lib/mode-templates.ts (Docker runtime). */
export const MODE_SEEDS: ModeSeed[] = [
  { appId: 'soundsuite', name: 'ss-embedding', label: 'Text embedding', availableOn: ALL, requiresGpu: true,
    kind: 'ollama', image: 'ollama/ollama', port: 11434, vramMb: 1200, runtimes: OLLAMA_RT, defaultModels: { default: 'qwen3-embedding:0.6b' },
    description: 'Document and query embedding via Ollama. About 1.2 GB VRAM. Used for indexing and search.' },
  { appId: 'soundsuite', name: 'ss-code-embedding', label: 'Code embedding', availableOn: ALL, requiresGpu: true,
    kind: 'ollama', image: 'ollama/ollama', port: 11437, vramMb: 2000, runtimes: OLLAMA_RT, defaultModels: { default: CODE_EMBED_MODEL },
    description: 'Code-aware embedding via Ollama for agent and code search. About 2 GB VRAM.' },
  { appId: 'soundsuite', name: 'ss-completion', label: 'Completion', availableOn: ALL, requiresGpu: true,
    kind: 'ollama', image: 'ollama/ollama', port: 11435, vramMb: 10000, runtimes: OLLAMA_RT, defaultModels: { default: 'qwen3.5:9b' },
    description: 'Chat completion via Ollama. About 10 GB VRAM. Used at search time.' },
  { appId: 'soundsuite', name: 'ss-ocr', label: 'OCR', availableOn: ALL, requiresGpu: true,
    kind: 'ollama', image: 'ollama/ollama', port: 11436, vramMb: 5000, runtimes: OLLAMA_RT, defaultModels: { default: 'minicpm-v:latest' },
    description: 'Visual OCR for low-density PDF pages and exhibit images. About 5 GB VRAM.' },
  { appId: 'soundsuite', name: 'ss-reranker', label: 'Reranker (cross-encoder)', availableOn: NO_MAC, requiresGpu: true,
    kind: 'vllm', image: VLLM_IMAGE, port: 8099, vramMb: 7000, runtimes: VLLM_RT, defaultModels: { default: 'Qwen/Qwen3-Reranker-8B' },
    description: 'vLLM cross-encoder reranker. Linux or Windows Docker (WSL2) with an NVIDIA GPU. Not on Mac.' },
  { appId: 'soundsuite', name: 'ss-rlm', label: 'RLM (recursive reasoning)', availableOn: NO_MAC, requiresGpu: true,
    kind: 'vllm', image: VLLM_IMAGE, port: 8100, vramMb: 10000, runtimes: VLLM_RT, defaultModels: { default: 'mit-oasys/rlm-qwen3-8b-v0.1' },
    description: 'Recursive Language Model (Qwen3-8B) via Docker vLLM on Linux or Windows with NVIDIA. About 10 GB VRAM.' },
  { appId: 'soundsuite', name: 'ss-rlm-sandbox', label: 'RLM sandbox (hosted)', availableOn: ALL, requiresGpu: false,
    kind: 'utility', image: 'ghcr.io/project-sandstar/rlm-sandbox:0.1.2', port: 8101, vramMb: 0, runtimes: ['docker-cpu'], defaultModels: {},
    description: 'Fallback for ss-rlm: a sandboxed Python REPL that drives a hosted OpenRouter model. No GPU.' },
  { appId: 'fantom', name: 'fantom-code-embedding', label: 'Fantom code embedding', availableOn: ALL, requiresGpu: true,
    kind: 'ollama', image: 'ollama/ollama', port: 11438, vramMb: 2000, runtimes: OLLAMA_RT, defaultModels: { default: CODE_EMBED_MODEL },
    description: 'Code embedding for Fantom MCP. Own mode; Fantom no longer borrows ss-code-embedding (decision 7).' },
];

/** AppMode row data for a seed (JSON columns as strings). */
export function modeSeedRow(m: ModeSeed) {
  return {
    appId: m.appId, name: m.name, label: m.label, description: m.description, requiresGpu: m.requiresGpu,
    availableOn: JSON.stringify(m.availableOn), kind: m.kind, image: m.image, port: m.port, vramMb: m.vramMb,
    runtimes: JSON.stringify(m.runtimes), defaultModels: JSON.stringify(m.defaultModels), defaultModel: m.defaultModels.default ?? null,
  };
}
