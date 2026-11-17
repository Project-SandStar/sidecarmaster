/** Ported from court-lens-mcp src/components/__tests__/admin-role-assignments-ports.test.ts. */
import { describe, expect, it } from 'vitest';
import {
  availableRuntimesForOs, defaultRuntimeForRow, effectiveRuntime, hostOsKind, inferHostOs, portForRuntime, reportedPortFor, roleKey,
  runtimeBlockReason, seedMode,
} from '@/lib/control/ports';
import { snapContainers } from '@/lib/fleet/db-status';
import { reportedOs } from '@/lib/fleet/relay-adapter';
import type { ContainerLive } from '@/lib/fleet/interfaces';

const OLLAMA_ROLES = ['ss-embedding', 'ss-code-embedding', 'ss-completion', 'ss-ocr'];
const mac: ContainerLive[] = [
  { name: 'ss-embedding', role: 'embedding', state: 'running', image: 'host-ollama', port: 11434 },
  { name: 'ss-code-embedding', role: 'code-embedding', state: 'running', image: 'host-ollama', port: 11434 },
  { name: 'ss-cuda', role: 'cuda', state: 'stopped', image: null, port: 0 },
];
const win: ContainerLive[] = [
  { name: 'ss-embedding', role: 'embedding', state: 'running', image: 'ollama/ollama', port: 11434 },
  { name: 'ss-code-embedding', role: 'code-embedding', state: 'running', image: 'ollama/ollama', port: 11437 },
];

describe('portForRuntime', () => {
  it('host runtime: every Ollama role on the one native port', () => {
    for (const r of OLLAMA_ROLES) expect(portForRuntime(r, 'host')).toBe(11434);
  });
  it('DMR: one endpoint', () => {
    expect(portForRuntime('ss-reranker', 'docker-model-runner')).toBe(12434);
    expect(portForRuntime('ss-rlm', 'docker-model-runner')).toBe(12434);
  });
  it('Docker runtimes keep per-role ports', () => {
    expect(portForRuntime('ss-code-embedding', 'docker-ollama')).toBe(11437);
    expect(portForRuntime('ss-ocr', 'docker-ollama')).toBe(11436);
    expect(portForRuntime('ss-reranker', 'docker-vllm')).toBe(8099);
    expect(portForRuntime('fantom-code-embedding', 'docker-ollama')).toBe(11438);
  });
  it('unknown role → undefined', () => expect(portForRuntime('ss-unknown', 'docker-ollama')).toBeUndefined());
});

describe('reportedPortFor', () => {
  it('trusts the reported port when the runtime matches', () => {
    expect(reportedPortFor(mac, 'soundsuite', 'ss-code-embedding', 'host')).toBe(11434);
    expect(reportedPortFor(win, 'soundsuite', 'ss-code-embedding', 'docker-ollama')).toBe(11437);
  });
  it('ignores a port from another runtime', () => {
    expect(reportedPortFor(mac, 'soundsuite', 'ss-embedding', 'docker-ollama')).toBeUndefined();
    expect(reportedPortFor(win, 'soundsuite', 'ss-embedding', 'host')).toBeUndefined();
  });
  it('never reports port 0', () => expect(reportedPortFor(mac, 'soundsuite', 'ss-cuda', 'docker-ollama')).toBeUndefined());
  it('no container → undefined', () => {
    expect(reportedPortFor(mac, 'soundsuite', 'ss-reranker', 'host')).toBeUndefined();
    expect(reportedPortFor(undefined, 'soundsuite', 'ss-embedding', 'host')).toBeUndefined();
  });
});

describe('defaultRuntimeForRow', () => {
  it('Mac Ollama roles default to host (shared port)', () => {
    for (const r of OLLAMA_ROLES) expect(portForRuntime(r, defaultRuntimeForRow(r, 'mac-docker-ollama'))).toBe(11434);
  });
  it('ss-rlm on Mac → DMR', () => expect(portForRuntime('ss-rlm', defaultRuntimeForRow('ss-rlm', 'mac-docker-ollama'))).toBe(12434));
  it('Windows keeps per-role Docker ports', () => expect(portForRuntime('ss-code-embedding', defaultRuntimeForRow('ss-code-embedding', 'windows-docker-wsl2'))).toBe(11437));
  it('ss-rlm-sandbox is docker-cpu on 8101 everywhere', () => {
    for (const os of ['linux', 'mac-docker-ollama', 'windows-docker-wsl2']) {
      expect(defaultRuntimeForRow('ss-rlm-sandbox', os)).toBe('docker-cpu');
      expect(portForRuntime('ss-rlm-sandbox', defaultRuntimeForRow('ss-rlm-sandbox', os))).toBe(8101);
    }
  });
});

describe('helpers', () => {
  it('roleKey drops ss- for Sound Suite only', () => {
    expect(roleKey('soundsuite', 'ss-ocr')).toBe('ocr');
    expect(roleKey('fantom', 'fantom-code-embedding')).toBe('fantom-code-embedding');
  });
  it('hostOsKind normalises', () => {
    expect(hostOsKind('darwin')).toBe('mac-docker-ollama');
    expect(hostOsKind('Windows')).toBe('windows-docker-wsl2');
    expect(hostOsKind('ubuntu')).toBe('linux');
    expect(hostOsKind('beos')).toBeNull();
  });
});

describe('runtimes per OS (Sound Suite availableRuntimesForOs)', () => {
  it('Mac: native Ollama, DMR and docker-cpu; no GPU Docker', () => {
    expect(availableRuntimesForOs('mac-docker-ollama')).toEqual(['host', 'docker-model-runner', 'docker-cpu']);
  });
  it('Windows: Docker Ollama, vLLM, DMR, docker-cpu; no native Ollama', () => {
    expect(availableRuntimesForOs('windows-docker-wsl2')).toEqual(['docker-ollama', 'docker-vllm', 'docker-model-runner', 'docker-cpu']);
  });
  it('Linux and unknown: everything', () => {
    expect(availableRuntimesForOs('linux')).toHaveLength(5);
    expect(availableRuntimesForOs(null)).toHaveLength(5);
  });
});

describe('runtimes per mode (Sound Suite runtimesForMode)', () => {
  const m = (n: string) => seedMode(n)!;
  it('Ollama roles allow host, docker-ollama, docker-vllm and DMR, not docker-cpu', () => {
    for (const r of [...OLLAMA_ROLES, 'fantom-code-embedding']) expect([...m(r).runtimes].sort()).toEqual(['docker-model-runner', 'docker-ollama', 'docker-vllm', 'host']);
  });
  it('reranker and rlm: vLLM engines only', () => {
    for (const r of ['ss-reranker', 'ss-rlm']) expect([...m(r).runtimes].sort()).toEqual(['docker-model-runner', 'docker-vllm']);
  });
  it('rlm-sandbox: docker-cpu only, pinned over a stale stored value', () => {
    expect(m('ss-rlm-sandbox').runtimes).toEqual(['docker-cpu']);
    expect(effectiveRuntime(m('ss-rlm-sandbox'), 'host', 'linux')).toBe('docker-cpu');
  });
  it('block reasons: docker-ollama on Mac, host on Windows, docker-cpu for an Ollama role', () => {
    expect(runtimeBlockReason(m('ss-ocr'), 'mac-docker-ollama', 'docker-ollama')).toMatch(/GPU passthrough/);
    expect(runtimeBlockReason(m('ss-ocr'), 'windows-docker-wsl2', 'host')).not.toBeNull();
    expect(runtimeBlockReason(m('ss-ocr'), 'linux', 'docker-cpu')).not.toBeNull();
    expect(runtimeBlockReason(m('ss-ocr'), 'windows-docker-wsl2', 'docker-vllm')).toBeNull();
  });
  it('stored runtime wins, else OS default', () => {
    expect(effectiveRuntime(m('ss-ocr'), 'docker-ollama', 'mac-docker-ollama')).toBe('docker-ollama');
    expect(effectiveRuntime(m('ss-ocr'), null, 'mac-docker-ollama')).toBe('host');
    expect(effectiveRuntime(m('ss-reranker'), null, 'linux')).toBe('docker-vllm');
  });
});

describe('host OS (Sound Suite inferOs)', () => {
  it('override, then reported, then hostname guess', () => {
    expect(inferHostOs('linux', 'darwin', 'mac-1')).toBe('linux');
    expect(inferHostOs(null, 'win32', 'x')).toBe('windows-docker-wsl2');
    expect(inferHostOs(null, null, 'mcpserver.local')).toBe('mac-docker-ollama');
    expect(inferHostOs(null, null, 'Studio-Mac-mini')).toBe('mac-docker-ollama');
    expect(inferHostOs(null, null, 'gpuws41')).toBe('linux');
    expect(inferHostOs(null, null, null)).toBeNull();
  });
  it('reads statusData.host.os from heartbeats', () => {
    expect(reportedOs({ host: { os: 'mac-docker-ollama' } })).toBe('mac-docker-ollama');
    expect(reportedOs({ os: 'linux' })).toBe('linux');
    expect(reportedOs({})).toBeNull();
  });
});

describe('heartbeat containers', () => {
  it('reads config.port like Sound Suite reportedPortFor', () => {
    const c = snapContainers({ embedding: { image: 'host-ollama', status: 'running', config: { port: 11434, model: 'q' } } });
    expect(c[0]).toMatchObject({ role: 'embedding', port: 11434, model: 'q', image: 'host-ollama' });
    expect(reportedPortFor(c, 'soundsuite', 'ss-embedding', 'host')).toBe(11434);
  });
});
