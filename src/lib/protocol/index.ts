/**
 * Sidecar <-> master wire protocol (task 2.1). Shared, versioned frame types.
 *
 * v1: the frames Sound Suite's relay and the sideCar ws-client exchange today
 *     (register, heartbeat, result | registered, command, config, master-identity).
 * v2: SPEC §6.1 additions (masters, masters-ack). Not sent by any sidecar yet.
 *
 * Frames are JSON text over WebSocket on path `/sidecar`. Unknown extra fields are
 * kept as is (sidecars add fields over time), so parse -> stringify is lossless.
 */

export const PROTOCOL_VERSIONS = [1, 2] as const;
export type ProtocolVersion = (typeof PROTOCOL_VERSIONS)[number];
/** Header a v2 sidecar sends on connect. Absent = v1. */
export const PROTOCOL_HEADER = 'x-sidecar-protocol';
export const WS_PATH = '/sidecar';
/** HTTP header the master sets so HTTP-only sidecars learn its canonical URL (v1 name, kept). */
export const MASTER_URL_HEADER = 'X-Sound-Suite-Master-Url';

export interface GpuInfo {
  index: number; name: string; memoryTotal: number; memoryUsed: number; memoryFree: number; temperature: number;
  processes?: Array<{ pid: number; name: string; usedMemory: number }>;
}

/** `statusData` in a heartbeat (sideCar buildFullStatus). All fields optional; extra fields allowed. */
export interface SidecarStatusData {
  agentUrl?: string; hostname?: string; version?: string; mode?: string; uptime?: number;
  containers?: unknown; activeRequests?: number; idleTimeouts?: Record<string, number>;
  roles?: unknown; peakDemand?: unknown; gpus?: GpuInfo[]; freeVram?: number; totalVram?: number;
  wsConnected?: boolean; containerNames?: string[]; masters?: unknown[]; lastConfigPushAt?: number | null;
  vram?: unknown; dockerMode?: string; mastersRev?: number; hostId?: string;
  [k: string]: unknown;
}

// ─── sidecar -> master ────────────────────────────────────────────────────
export interface RegisterFrame {
  type: 'register'; agentUrl: string; hostname?: string; containers?: string[];
  /** v2: stable id from join. */
  hostId?: string;
  [k: string]: unknown;
}
export interface HeartbeatFrame {
  type: 'heartbeat'; containers?: string[]; activeRequests?: number; statusData?: SidecarStatusData;
  [k: string]: unknown;
}
export interface ResultFrame { type: 'result'; id: string; error?: string; [k: string]: unknown }
/** v2 */
export interface MastersAckFrame { type: 'masters-ack'; rev: number; [k: string]: unknown }
export type SidecarFrame = RegisterFrame | HeartbeatFrame | ResultFrame | MastersAckFrame;

// ─── master -> sidecar ────────────────────────────────────────────────────
export interface RegisteredFrame { type: 'registered'; ok: boolean; error?: string }
export interface CommandFrame { type: 'command'; id: string; action: string; [k: string]: unknown }
export interface ConfigFrame { type: 'config' | 'config-push'; id?: string; payload?: Record<string, unknown>; [k: string]: unknown }
/** wsPort is optional: left out when no public endpoint matches the sidecar's network. */
export interface MasterIdentityFrame { type: 'master-identity'; canonicalUrl: string; wsPort?: number; name?: string; pushedAt: number }
/** v2 */
export interface MasterEntry { appId: string; serverUrl: string; wsUrl?: string | null; authToken?: string; managed: boolean }
/** v2 */
export interface MastersFrame { type: 'masters'; rev: number; masters: MasterEntry[] }
export type MasterFrame = RegisteredFrame | CommandFrame | ConfigFrame | MasterIdentityFrame | MastersFrame;

export type ParseResult<T> = { ok: true; frame: T } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const optStr = (o: Record<string, unknown>, k: string) => o[k] === undefined || typeof o[k] === 'string';
const optNum = (o: Record<string, unknown>, k: string) => o[k] === undefined || typeof o[k] === 'number';
const optArr = (o: Record<string, unknown>, k: string) => o[k] === undefined || Array.isArray(o[k]);

function decode(raw: unknown): Record<string, unknown> | string {
  let v: unknown = raw;
  if (typeof raw === 'string' || raw instanceof Uint8Array) {
    try { v = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8')); } catch { return 'invalid JSON'; }
  }
  if (!isObj(v)) return 'frame must be a JSON object';
  if (typeof v.type !== 'string') return 'frame has no type';
  return v;
}

/** Validate a frame sent by a sidecar. Accepts a JSON string, a Buffer, or an object. */
export function parseSidecarFrame(raw: unknown): ParseResult<SidecarFrame> {
  const o = decode(raw);
  if (typeof o === 'string') return { ok: false, error: o };
  switch (o.type) {
    case 'register':
      if (typeof o.agentUrl !== 'string' || !o.agentUrl) return { ok: false, error: 'register: agentUrl required' };
      if (!optStr(o, 'hostname') || !optArr(o, 'containers') || !optStr(o, 'hostId')) return { ok: false, error: 'register: bad field type' };
      return { ok: true, frame: o as RegisterFrame };
    case 'heartbeat':
      if (!optArr(o, 'containers') || !optNum(o, 'activeRequests')) return { ok: false, error: 'heartbeat: bad field type' };
      if (o.statusData !== undefined && !isObj(o.statusData)) return { ok: false, error: 'heartbeat: statusData must be an object' };
      return { ok: true, frame: o as HeartbeatFrame };
    case 'result':
      if (typeof o.id !== 'string' || !o.id) return { ok: false, error: 'result: id required' };
      if (!optStr(o, 'error')) return { ok: false, error: 'result: error must be a string' };
      return { ok: true, frame: o as ResultFrame };
    case 'masters-ack':
      if (typeof o.rev !== 'number') return { ok: false, error: 'masters-ack: rev required' };
      return { ok: true, frame: o as MastersAckFrame };
    default:
      return { ok: false, error: `unknown sidecar frame type "${String(o.type)}"` };
  }
}

/** Validate a frame sent by a master (used by tests and the fake sidecar). */
export function parseMasterFrame(raw: unknown): ParseResult<MasterFrame> {
  const o = decode(raw);
  if (typeof o === 'string') return { ok: false, error: o };
  switch (o.type) {
    case 'registered':
      return typeof o.ok === 'boolean' && optStr(o, 'error') ? { ok: true, frame: o as unknown as RegisteredFrame } : { ok: false, error: 'registered: ok required' };
    case 'command':
      return typeof o.id === 'string' && typeof o.action === 'string' ? { ok: true, frame: o as CommandFrame } : { ok: false, error: 'command: id and action required' };
    case 'config': case 'config-push':
      return o.payload === undefined || isObj(o.payload) ? { ok: true, frame: o as ConfigFrame } : { ok: false, error: 'config: payload must be an object' };
    case 'master-identity':
      return typeof o.canonicalUrl === 'string' && (o.wsPort === undefined || typeof o.wsPort === 'number') && typeof o.pushedAt === 'number'
        ? { ok: true, frame: o as unknown as MasterIdentityFrame } : { ok: false, error: 'master-identity: canonicalUrl, pushedAt required (wsPort a number if present)' };
    case 'masters': {
      if (typeof o.rev !== 'number' || !Array.isArray(o.masters)) return { ok: false, error: 'masters: rev and masters[] required' };
      const bad = o.masters.find((m) => !isObj(m) || typeof m.appId !== 'string' || typeof m.serverUrl !== 'string' || typeof m.managed !== 'boolean');
      return bad ? { ok: false, error: 'masters: each entry needs appId, serverUrl, managed' } : { ok: true, frame: o as unknown as MastersFrame };
    }
    default:
      return { ok: false, error: `unknown master frame type "${String(o.type)}"` };
  }
}

/** Protocol version a connecting sidecar speaks (header `X-Sidecar-Protocol`, default 1). */
export function protocolVersionOf(headers: Record<string, string | string[] | undefined>): ProtocolVersion {
  const v = headers[PROTOCOL_HEADER];
  return (Array.isArray(v) ? v[0] : v) === '2' ? 2 : 1;
}

/** Strip trailing slashes; the sidecar and Sound Suite key masters/sidecars this way. */
export function normalizeUrl(u: string): string {
  return u.trim().replace(/\/+$/, '');
}
