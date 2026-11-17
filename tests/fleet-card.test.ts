import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildRoleChips, collectErrors, containerNamesOf, fmtIdle, fmtUntil, fmtUptime, gpuBadge, gpuBarClass, hiddenRolesLabel, hostState, parseContainers,
  resolveOs, ROLE_STATE_LEGEND, roleState, runtimeLabel, splitRoleChips, transportChip,
} from '@/lib/fleet/card';
import { buildFleetView, type HostRowInput } from '@/lib/fleet/view';
import type { LiveHostStatus } from '@/lib/relay/live-store';

// HostCard renders ActionButton, which needs the app router hook.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

/** Heartbeat in the shape a Sound Suite sidecar sends (containers keyed by role). */
const heartbeat = {
  hostname: 'gpu1', version: '2.4.1', mode: 'websocket', uptime: 90_000, activeRequests: 1, dockerMode: 'nvidia',
  host: { os: 'linux' },
  containers: {
    ocr: {
      role: 'ocr', name: 'ss-ocr', exists: true, status: 'running', image: 'ollama/ollama:latest', port: 11435, model: 'qwen2.5vl:7b', type: 'ollama',
      config: { image: 'ollama/ollama:latest', model: 'qwen2.5vl:7b', port: 11435, vram: 8000, type: 'ollama', gpuOnly: true }, gpuReady: true,
      loadedModels: [{ name: 'qwen2.5vl:7b', size: '6.0 GB', sizeBytes: 6e9, sizeVram: 6e9, gpuPercent: 100, processor: '100% GPU', until: '2099-01-01T00:00:00Z' }],
    },
    embedding: { role: 'embedding', name: 'ss-embedding', exists: true, status: 'exited', image: 'host-ollama', port: 11434, model: 'nomic-embed-text', type: 'ollama' },
    reranker: { role: 'reranker', name: 'ss-reranker', exists: false, status: 'not_found', model: null },
    whisper: { role: 'whisper', name: 'ss-whisper', exists: true, status: 'running', image: 'vllm/vllm-openai:v0.6', port: 8000, type: 'vllm' },
  },
  idleTimeouts: { ocr: 300_000, embedding: 0 },
  roles: { ocr: { activeRequests: 2, idleTimerActive: true, lastAcquire: null, lastRelease: null } },
  errors: ['disk low'],
  tasks: [{ type: 'pull', label: 'pull qwen', status: 'failed', error: 'no space' }],
};
const assignments = [
  { mode: 'ss-ocr', enabled: true, appId: 'soundsuite', runtime: 'docker-ollama', idleTimeoutMin: 5 },
  { mode: 'ss-embedding', enabled: true, appId: 'soundsuite', runtime: 'host', idleTimeoutMin: 10 },
  { mode: 'ss-reranker', enabled: true, appId: 'soundsuite', runtime: null, idleTimeoutMin: 5, modelOverride: 'bge-reranker' },
  { mode: 'ss-vision', enabled: false, appId: 'soundsuite', runtime: null, idleTimeoutMin: 5 },
];

const host = (o: Partial<HostRowInput> = {}): HostRowInput => ({
  id: 'h1', name: 'gpu1', agentUrl: 'http://10.0.0.1:8098', hostname: 'gpu1', os: null, lastHeartbeatAt: null, sidecarVersion: null,
  statusSnapshot: null, liveStatus: null, hostOsOverride: null, aliases: [], roles: assignments, ...o,
});
const live = (o: Partial<LiveHostStatus> = {}): LiveHostStatus => ({
  agentUrl: 'http://10.0.0.1:8098', hostId: 'h1', hostname: 'gpu1', connected: true, transport: 'ws', protocolVersion: 1,
  connectedAt: 1, lastHeartbeatAt: 1000, observedFromIp: '10.0.0.1', version: '2.4.1', mode: 'websocket', uptime: 90_000,
  gpus: [{ index: 0, name: 'NVIDIA RTX A6000', memoryTotal: 49152, memoryUsed: 9830, memoryFree: 39322, temperature: 41 }],
  containers: ['ss-ocr', 'ss-embedding', 'ss-reranker', 'ss-whisper'], activeRequests: 1, statusData: heartbeat, ...o,
});

describe('state colours (Sound Suite palette)', () => {
  it('container states: running green, stopped orange, not provisioned yellow, starting blue, no data grey', () => {
    expect(roleState('running', true)).toMatchObject({ state: 'running', cls: 'bg-green-100 text-green-800' });
    expect(roleState('exited', true)).toMatchObject({ state: 'stopped', label: 'stopped', cls: 'bg-orange-100 text-orange-800' });
    expect(roleState('not_found', false)).toMatchObject({ state: 'missing', label: 'not provisioned', cls: 'bg-yellow-100 text-yellow-800' });
    expect(roleState('created', true)).toMatchObject({ state: 'created', label: 'created', cls: 'bg-slate-200 text-slate-800' });
    expect(roleState('Created', null)).toMatchObject({ state: 'created' });
    expect(roleState('starting', true)).toMatchObject({ state: 'starting', cls: 'bg-blue-100 text-blue-800' });
    expect(roleState(null, null)).toMatchObject({ state: 'unknown', label: 'no data' });
  });

  it('host states: WS live green, HTTP yellow, offline red, never seen grey', () => {
    expect(hostState({ connected: true, transport: 'ws', lastHeartbeatAt: 1 })).toMatchObject({ state: 'live', dot: 'bg-green-500' });
    expect(hostState({ connected: true, transport: 'http', lastHeartbeatAt: 1 })).toMatchObject({ state: 'http', dot: 'bg-yellow-500' });
    expect(hostState({ connected: false, transport: 'ws', lastHeartbeatAt: 1 })).toMatchObject({ state: 'offline', dot: 'bg-red-500' });
    expect(hostState({ connected: false, transport: null, lastHeartbeatAt: null })).toMatchObject({ state: 'never', dot: 'bg-gray-300' });
    expect(transportChip(true, 'ws')).toMatchObject({ label: 'WS', cls: 'bg-purple-100 text-purple-800' });
    expect(transportChip(true, 'http')).toMatchObject({ label: 'HTTP', cls: 'bg-blue-100 text-blue-800' });
    expect(transportChip(false, 'ws').label).toBe('last: WS');
  });

  it('GPU bar: green under 70 %, yellow to 90 %, red above', () => {
    expect(gpuBarClass(20)).toBe('bg-green-500');
    expect(gpuBarClass(80)).toBe('bg-yellow-500');
    expect(gpuBarClass(95)).toBe('bg-red-500');
    expect(gpuBadge({ name: 'NVIDIA RTX A6000', memoryTotal: 49152 })).toBe('RTX A6000 48 GB');
  });
});

describe('runtime and OS labels', () => {
  it('reads the runtime from the image first, then the assignment', () => {
    expect(runtimeLabel('host-ollama', null)).toBe('Ollama (native)');
    expect(runtimeLabel('ollama/ollama:latest', 'host')).toBe('Docker Ollama');
    expect(runtimeLabel('vllm/vllm-openai:v0.6', null)).toBe('Docker vLLM');
    expect(runtimeLabel(null, 'docker-model-runner')).toBe('Docker Model Runner');
    expect(runtimeLabel(null, null)).toBe('—');
  });

  it('OS: reported beats override beats hostname guess', () => {
    expect(resolveOs('windows-docker-wsl2', 'darwin', 'box')).toMatchObject({ kind: 'mac-docker-ollama', source: 'reported' });
    expect(resolveOs('windows-docker-wsl2', null, 'box')).toMatchObject({ kind: 'windows-docker-wsl2', source: 'override', label: 'Windows Docker (WSL2)' });
    expect(resolveOs(null, null, 'macmini.local')).toMatchObject({ kind: 'mac-docker-ollama', source: 'guessed' });
    expect(resolveOs(null, null, null)).toMatchObject({ kind: null, label: 'OS unknown' });
  });

  it('formats times', () => {
    expect(fmtIdle(0)).toBe('never');
    expect(fmtIdle(300_000)).toBe('5 min');
    expect(fmtUptime(90_000)).toBe('1d 1h');
    expect(fmtUntil('2099-01-01T00:00:00Z', Date.parse('2098-12-31T23:30:00Z'))).toBe('30m');
    expect(fmtUntil('forever', 0)).toBe('forever');
  });
});

describe('role chips from a heartbeat', () => {
  it('parses the containers record and the saved name list', () => {
    const cs = parseContainers(heartbeat.containers);
    expect(cs.map((c) => c.role)).toEqual(['ocr', 'embedding', 'reranker', 'whisper']);
    expect(cs[0]).toMatchObject({ name: 'ss-ocr', status: 'running', port: 11435, vramMb: 8000, gpuOnly: true, gpuReady: true });
    expect(cs[0].loaded[0]).toMatchObject({ name: 'qwen2.5vl:7b', sizeBytes: 6e9, gpuPercent: 100 });
    expect(parseContainers(['ss-ocr'])[0]).toMatchObject({ role: 'ss-ocr', name: 'ss-ocr', status: null });
  });

  it('joins enabled assignments with live containers on the sidecar role key', () => {
    const chips = buildRoleChips(heartbeat, assignments);
    expect(chips.map((c) => c.key)).toEqual(['embedding', 'ocr', 'reranker', 'whisper']);
    const ocr = chips.find((c) => c.key === 'ocr')!;
    expect(ocr).toMatchObject({
      mode: 'ss-ocr', assigned: true, state: 'running', stateClass: 'bg-green-100 text-green-800', runtime: 'Docker Ollama', port: 11435,
      model: 'qwen2.5vl:7b', idleTimeoutMs: 300_000, idleTimerActive: true, activeRequests: 2, container: 'ss-ocr',
    });
    expect(ocr.loaded[0].name).toBe('qwen2.5vl:7b');
    expect(chips.find((c) => c.key === 'embedding')).toMatchObject({ state: 'stopped', runtime: 'Ollama (native)', idleTimeoutMs: 0, stateClass: 'bg-orange-100 text-orange-800' });
    // Not on the box: yellow, model from the override, idle from the assignment.
    expect(chips.find((c) => c.key === 'reranker')).toMatchObject({ state: 'missing', stateLabel: 'not provisioned', model: 'bge-reranker', idleTimeoutMs: 300_000 });
    // Runs on the box without an enabled assignment: shown and marked.
    expect(chips.find((c) => c.key === 'whisper')).toMatchObject({ assigned: false, state: 'running', runtime: 'Docker vLLM', port: 8000 });
    expect(chips.find((c) => c.key === 'vision')).toBeUndefined();
  });

  it('collects errors from errors[], failed tasks and per-container errors', () => {
    expect(collectErrors(heartbeat)).toEqual(['disk low', 'pull qwen failed: no space']);
    expect(collectErrors({ containers: { ocr: { name: 'ss-ocr', error: 'oom' } } })).toEqual(['ss-ocr: oom']);
    expect(collectErrors(null)).toEqual([]);
    expect(containerNamesOf(heartbeat, [])).toEqual(['ss-ocr', 'ss-embedding', 'ss-reranker', 'ss-whisper']);
    expect(containerNamesOf(null, ['a'])).toEqual(['a']);
  });
});

describe('fleet rows carry the card data', () => {
  it('live row: OS, uptime, chips, container names, errors', () => {
    const [r] = buildFleetView([host()], [live()]);
    expect(r).toMatchObject({ connected: true, version: '2.4.1', uptime: 90_000, dockerMode: 'nvidia', observedFromIp: '10.0.0.1', source: 'live' });
    expect(r.os).toMatchObject({ kind: 'linux', label: 'Linux', source: 'reported' });
    expect(r.roles.map((c) => [c.key, c.state])).toEqual([['embedding', 'stopped'], ['ocr', 'running'], ['reranker', 'missing'], ['whisper', 'running']]);
    expect(r.containerNames).toEqual(['ss-ocr', 'ss-embedding', 'ss-reranker', 'ss-whisper']);
    expect(r.errors).toEqual(['disk low', 'pull qwen failed: no space']);
  });

  it('saved row after a restart: chips from the assignments, no data for the containers', () => {
    const [r] = buildFleetView([host({
      hostOsOverride: 'windows-docker-wsl2', lastHeartbeatAt: new Date(5000),
      liveStatus: JSON.stringify({ transport: 'ws', version: '2.3', uptime: 10, containers: ['ss-ocr'], gpus: [] }),
    })], []);
    expect(r).toMatchObject({ connected: false, source: 'saved', version: '2.3', uptime: 10, containers: 1, containerNames: ['ss-ocr'] });
    expect(r.os).toMatchObject({ kind: 'windows-docker-wsl2', source: 'override' });
    expect(r.roles.find((c) => c.key === 'ocr')).toMatchObject({ state: 'unknown', container: 'ss-ocr', runtime: 'Docker Ollama' });
    expect(r.roles.find((c) => c.key === 'reranker')).toMatchObject({ state: 'missing' });
    expect(r.errors).toEqual([]);
  });
});

describe('HostCard markup', () => {
  it('shows GPU, version, protocol, heartbeat, role chips and disables Provision while reconcile is off', async () => {
    const { HostCard } = await import('@/components/HostCards');
    const [r] = buildFleetView([host()], [live()]);
    const html = renderToStaticMarkup(createElement(HostCard, { r, now: 61_000, reconcileOff: true, canAct: true }));
    expect(html).toContain('RTX A6000 48 GB');
    expect(html).toContain('v2.4.1');
    expect(html).toContain('protocol <b class="text-gray-700">v1</b>');
    expect(html).toContain('1m ago');
    expect(html).toContain('border-l-green-500');
    expect(html).toContain('>WS<');
    expect(html).toContain('>Linux<');
    for (const k of ['ocr', 'embedding', 'whisper']) expect(html).toContain(`data-role="${k}"`);
    // reranker has no container here: hidden behind the toggle.
    expect(html).not.toContain('data-role="reranker"');
    expect(html).toContain('1 assigned role not running here — show');
    expect(html).toContain('qwen2.5vl:7b');
    expect(html).toContain('disk low');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Provision<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Update sidecar<\/button>/);
  });

  it('offline host: red border, last transport muted, "not seen yet" for import-only hosts', async () => {
    const { HostCard } = await import('@/components/HostCards');
    const [off] = buildFleetView([host({ lastHeartbeatAt: new Date(1000), liveStatus: JSON.stringify({ transport: 'ws' }) })], []);
    const html = renderToStaticMarkup(createElement(HostCard, { r: off, now: 61_000, reconcileOff: true, canAct: false }));
    expect(html).toContain('border-l-red-500');
    expect(html).toContain('last: WS');
    expect(html).toContain('Host commands need the relay.');
    const [never] = buildFleetView([host({ roles: [] })], []);
    const html2 = renderToStaticMarkup(createElement(HostCard, { r: never, now: 61_000, reconcileOff: false, canAct: false }));
    expect(html2).toContain('not seen yet');
    expect(html2).toContain('No roles assigned and no containers reported.');
  });
});

describe('created state and hidden empty roles', () => {
  const hb = { containers: { ...heartbeat.containers, ocr: { ...heartbeat.containers.ocr, status: 'created' } } };

  it('a container in Docker state "created" gets its own state, not "not provisioned"', () => {
    const ocr = buildRoleChips(hb, assignments).find((c) => c.key === 'ocr')!;
    expect(ocr).toMatchObject({ state: 'created', stateLabel: 'created', stateClass: 'bg-slate-200 text-slate-800' });
    expect(ROLE_STATE_LEGEND.map((l) => l.state)).toEqual(['running', 'starting', 'created', 'stopped', 'missing', 'unknown']);
  });

  it('splits off the "not provisioned" chips; the created one stays shown', () => {
    const { shown, hidden } = splitRoleChips(buildRoleChips(hb, assignments));
    expect(hidden.map((c) => c.key)).toEqual(['reranker']);
    expect(shown.map((c) => c.key)).toEqual(['embedding', 'ocr', 'whisper']);
    expect(hiddenRolesLabel(1, false)).toBe('1 assigned role not running here — show');
    expect(hiddenRolesLabel(3, true)).toBe('3 assigned roles not running here — hide');
  });

  it('host card hides empty roles; the detail view (showAllRoles) shows them all', async () => {
    const { HostCard } = await import('@/components/HostCards');
    const [r] = buildFleetView([host()], [live({ statusData: hb })]);
    const card = renderToStaticMarkup(createElement(HostCard, { r, now: 0, reconcileOff: true, canAct: false }));
    expect(card).not.toContain('data-role="reranker"');
    expect(card).toContain('data-toggle="hidden-roles"');
    expect(card).toMatch(/bg-slate-200 text-slate-800[^>]*>(<span[^>]*><\/span>)?created</);
    const detail = renderToStaticMarkup(createElement(HostCard, { r, now: 0, reconcileOff: true, canAct: false, showAllRoles: true }));
    expect(detail).toContain('data-role="reranker"');
    expect(detail).toContain('not provisioned');
    expect(detail).not.toContain('data-toggle="hidden-roles"');
  });

  it('no toggle when every assigned role has a container', async () => {
    const { HostCard } = await import('@/components/HostCards');
    const rest = Object.fromEntries(Object.entries(heartbeat.containers).filter(([k]) => k !== 'reranker'));
    const [r] = buildFleetView([host({ roles: assignments.filter((a) => a.mode !== 'ss-reranker') })], [live({ statusData: { ...heartbeat, containers: rest } })]);
    const html = renderToStaticMarkup(createElement(HostCard, { r, now: 0, reconcileOff: true, canAct: false }));
    expect(html).not.toContain('data-toggle="hidden-roles"');
  });
});
