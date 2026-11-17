/**
 * Golden frames, copied from what Sound Suite's relay and the sideCar ws-client send today (v1)
 * and from SPEC §6.1 (v2). Tests round-trip each one through the parsers.
 */
export const V1_SIDECAR_FRAMES = {
  register: { type: 'register', agentUrl: 'http://100.100.192.119:8098', hostname: 'mcpserver', containers: ['ss-embedding', 'ss-ocr'] },
  heartbeat: {
    type: 'heartbeat', containers: ['ss-embedding'], activeRequests: 2,
    statusData: {
      agentUrl: 'http://100.100.192.119:8098', hostname: 'mcpserver', version: '2.4.1', mode: 'websocket', uptime: 3600,
      containers: { 'ss-embedding': { running: true } }, activeRequests: 2, idleTimeouts: { embedding: 5 },
      gpus: [{ index: 0, name: 'NVIDIA RTX 4090', memoryTotal: 24564, memoryUsed: 8000, memoryFree: 16564, temperature: 51 }],
      freeVram: 16564, totalVram: 24564, wsConnected: true, containerNames: ['ss-embedding'],
      masters: [{ serverUrl: 'http://100.100.170.238:3000', connected: true }], lastConfigPushAt: 1761800000000,
    },
  },
  result: { type: 'result', id: 'cmd-1761800000000-1', status: 'ok', data: { ok: true } },
  resultError: { type: 'result', id: 'cmd-1761800000000-2', error: 'container not found' },
} as const;

export const V1_MASTER_FRAMES = {
  registered: { type: 'registered', ok: true },
  registeredConflict: { type: 'registered', ok: false, error: 'address-conflict: http://192.168.20.6:8098 is already registered' },
  command: { type: 'command', id: 'cmd-1761800000000-1', action: '/status' },
  config: { type: 'config', id: 'cfg-1', payload: { idleTimeouts: { embedding: 5, completion: 10 } } },
  masterIdentity: { type: 'master-identity', canonicalUrl: 'https://sidecarmaster.vpn.example.com', wsPort: 3002, name: 'sidecarmaster', pushedAt: 1761800000000 },
} as const;

export const V2_SIDECAR_FRAMES = {
  register: { type: 'register', agentUrl: 'http://100.100.192.119:8098', hostname: 'mcpserver', hostId: 'h_01', containers: [] },
  mastersAck: { type: 'masters-ack', rev: 7 },
} as const;

export const V2_MASTER_FRAMES = {
  masters: {
    type: 'masters', rev: 7,
    masters: [
      { appId: 'soundsuite', serverUrl: 'http://100.100.170.238:3000', wsUrl: 'ws://100.100.170.238:3002/sidecar', managed: true },
      { appId: 'fantom', serverUrl: 'https://fantom.vpn.example.com', wsUrl: null, managed: true },
    ],
  },
} as const;
