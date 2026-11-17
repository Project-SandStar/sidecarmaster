/** Grid / availability tests, ported from court-lens-mcp admin-role-assignments(-ports).test.ts. */
import { describe, expect, it } from 'vitest';
import { MODE_SEEDS } from '@/lib/apps/catalog';
import {
  gpuSummary, gridCell, gridCells, gridColumns, loadedModels, osBlockReason, portNote, resetPlan, resolveHostOs,
  unavailableReason, type GridMode,
} from '@/lib/control/role-grid';
import { snapContainers } from '@/lib/fleet/db-status';

const modes: GridMode[] = MODE_SEEDS.map((m) => ({ appId: m.appId, name: m.name, kind: m.kind, runtimes: m.runtimes, availableOn: m.availableOn }));
const mode = (n: string) => modes.find((m) => m.name === n)!;
const avail = (n: string, os: Parameters<typeof gridCells>[1]) => gridCells(mode(n), os).filter((c) => c.available).map((c) => c.key);

describe('grid cells per OS', () => {
  it('Mac: Ollama roles only on native Ollama, DMR and no-GPU Docker', () => {
    expect(avail('ss-ocr', 'mac-docker-ollama')).not.toContain('docker-ollama');
    expect(avail('ss-ocr', 'mac-docker-ollama')).toContain('host');
  });
  it('Mac: the docker-ollama tooltip says there is no GPU passthrough', () => {
    expect(gridCell(mode('ss-ocr'), 'mac-docker-ollama', 'docker-ollama').tooltip).toMatch(/no GPU passthrough/);
  });
  it('Windows: no native Ollama', () => {
    expect(avail('ss-completion', 'windows-docker-wsl2')).not.toContain('host');
    expect(avail('ss-completion', 'windows-docker-wsl2')).toContain('docker-ollama');
    expect(osBlockReason('windows-docker-wsl2', 'host')).toMatch(/Native Ollama on Windows/);
  });
  it('Linux: everything the mode allows', () => {
    expect(avail('ss-completion', 'linux')).toEqual(expect.arrayContaining(['host', 'docker-ollama']));
  });
  it('a runtime the mode does not allow is greyed with its own reason', () => {
    const c = gridCell(mode('ss-rlm-sandbox'), 'linux', 'docker-ollama');
    expect(c.available).toBe(false);
    expect(c.tooltip).toMatch(/cannot run on Docker Ollama/);
    expect(avail('ss-rlm-sandbox', 'linux')).toEqual(['docker-cpu']);
  });
  it('reranker and rlm rows are fully greyed on Mac with the why', () => {
    expect(avail('ss-reranker', 'mac-docker-ollama')).toEqual([]);
    expect(avail('ss-rlm', 'mac-docker-ollama')).toEqual([]);
    expect(unavailableReason('ss-reranker', 'mac-docker-ollama')).toMatch(/cross-encoder/);
    expect(gridCell(mode('ss-rlm'), 'mac-docker-ollama', 'docker-model-runner').tooltip).toMatch(/MLX/);
  });
  it('unknown OS allows every runtime the mode allows', () => {
    expect(avail('ss-completion', null).length).toBeGreaterThan(1);
  });
});

describe('column headers', () => {
  it('Mac greys Docker Ollama and Docker vLLM', () => {
    const cols = Object.fromEntries(gridColumns(modes, 'mac-docker-ollama').map((c) => [c.key, c.available]));
    expect(cols['docker-ollama']).toBe(false);
    expect(cols['docker-vllm']).toBe(false);
    expect(cols.host).toBe(true);
  });
  it('a column no role can use is greyed even if the OS allows it', () => {
    const only = [mode('ss-rlm-sandbox')];
    const cols = Object.fromEntries(gridColumns(only, 'linux').map((c) => [c.key, c]));
    expect(cols['docker-ollama'].available).toBe(false);
    expect(cols['docker-ollama'].title).toMatch(/No role here/);
    expect(cols['docker-cpu'].available).toBe(true);
  });
});

describe('port marker', () => {
  it('native Ollama and DMR are shared ports', () => {
    expect(portNote('host', false, 'm').shared).toBe(true);
    expect(portNote('docker-model-runner', true, 'm').title).toMatch(/^Reported by m\./);
    expect(portNote('docker-ollama', false, 'm').shared).toBe(false);
  });
});

describe('host OS', () => {
  it('the reported OS wins over the manual override, and the tooltip says so', () => {
    const r = resolveHostOs('windows-docker-wsl2', 'linux', 'GPUWS41');
    expect(r.os).toBe('linux');
    expect(r.source).toBe('reported');
    expect(r.override).toBe('windows-docker-wsl2');
    expect(r.title).toMatch(/ignored/);
  });
  it('override is used when nothing is reported', () => {
    expect(resolveHostOs('windows-docker-wsl2', null, 'GPUWS41')).toMatchObject({ os: 'windows-docker-wsl2', source: 'override' });
  });
  it('falls back to a hostname guess', () => {
    expect(resolveHostOs(null, null, 'mcpserver.local')).toMatchObject({ os: 'mac-docker-ollama', source: 'guessed' });
    expect(resolveHostOs(null, 'darwin', null).os).toBe('mac-docker-ollama');
    expect(resolveHostOs(null, null, null).os).toBeNull();
  });
});

describe('badges and loaded models', () => {
  it('GPU badge drops "NVIDIA " and shows GB', () => {
    expect(gpuSummary([{ index: 0, name: 'NVIDIA RTX A6000', memoryTotalMb: 49140, memoryUsedMb: 0 }])).toBe('RTX A6000 48 GB');
    expect(gpuSummary([])).toBeNull();
  });
  it('loaded models are parsed from heartbeats and deduplicated', () => {
    const c = snapContainers({
      embedding: { image: 'host-ollama', loadedModels: [{ name: 'qwen3-embedding:0.6b', size: 1e9 }] },
      completion: { image: 'host-ollama', loadedModels: [{ name: 'qwen3-embedding:0.6b', size: 1e9 }, { name: 'qwen3.5:9b' }] },
    });
    expect(loadedModels(c).map((m) => m.name)).toEqual(['qwen3-embedding:0.6b', 'qwen3.5:9b']);
    // GPUWS41-style heartbeat: models as plain strings.
    const w = snapContainers({ ocr: { image: 'ollama/ollama', port: 11436, models: ['AuditAid/PaddleOCR-VL-1.6-0.9B:latest'] }, cuda: { models: [] } });
    expect(loadedModels(w)).toEqual([{ name: 'AuditAid/PaddleOCR-VL-1.6-0.9B:latest', size: null }]);
  });
});

describe('reset to defaults', () => {
  it('Mac: Ollama roles on native Ollama, reranker/rlm removed, sandbox on docker-cpu', () => {
    const p = Object.fromEntries(resetPlan(modes, 'mac-docker-ollama').map((x) => [x.mode, x]));
    expect(p['ss-completion']).toMatchObject({ enabled: true, runtime: 'host', minOnline: 1, idleTimeoutMin: 10 });
    expect(p['ss-reranker'].enabled).toBe(false);
    expect(p['ss-rlm'].enabled).toBe(false);
    expect(p['ss-rlm-sandbox']).toMatchObject({ enabled: true, runtime: 'docker-cpu', minOnline: 1, idleTimeoutMin: 0 });
  });
  it('Windows: Docker Ollama and Docker vLLM', () => {
    const p = Object.fromEntries(resetPlan(modes, 'windows-docker-wsl2').map((x) => [x.mode, x]));
    expect(p['ss-ocr'].runtime).toBe('docker-ollama');
    expect(p['ss-reranker']).toMatchObject({ enabled: true, runtime: 'docker-vllm' });
  });
});
