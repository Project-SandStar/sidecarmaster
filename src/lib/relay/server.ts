/**
 * Sidecar WebSocket relay (task 2.2, from Sound Suite's src/lib/gpu/ws-relay.ts).
 * Same port and path as Sound Suite (`ws://host:3002/sidecar`), same v1 frames, so an
 * unchanged sidecar can add sidecarmaster as one more master.
 *
 * Kept from Sound Suite: register timeout, ping/pong liveness with miss tolerance,
 * superseded-socket grace (no reconnect loop on re-register), address move re-key
 * with conflict refusal, master-identity push.
 * Left out on purpose (Phase 3/4): config auto-push, OpenRouter re-push, reassert watchdog.
 * sidecarmaster does not push policy yet.
 */
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  parseSidecarFrame, protocolVersionOf, normalizeUrl, WS_PATH,
  type CommandFrame, type MasterIdentityFrame, type ProtocolVersion, type ResultFrame,
} from '../protocol';
import * as store from './live-store';
import { chooseEndpoint, endpointsFromEnv, type PublicEndpoint } from './endpoints';

export interface RelayOptions {
  port?: number;
  host?: string;
  /** If set, sidecars must send `Authorization: Bearer <token>`. */
  token?: string | null;
  registerTimeoutMs?: number;
  sweepMs?: number;
  supersededGraceMs?: number;
  pingMissTolerance?: number;
  /** Canonical URL sent in the master-identity frame. No frame when empty. */
  publicUrl?: string | null;
  /**
   * Per-network endpoints (SM_PUBLIC_ENDPOINTS). When set, the wsPort in master-identity is the one
   * for the network the sidecar came from; with no match the frame carries no wsPort at all.
   * When empty, the bound port is sent (old behaviour). Default: read from env.
   */
  endpoints?: PublicEndpoint[];
  /** Called after register / heartbeat so the DB side can link hosts. Errors are logged. */
  onSeen?: (s: store.LiveHostStatus, kind: 'register' | 'heartbeat') => Promise<string | null | void>;
}

export class SidecarError extends Error {
  constructor(message: string) { super(message); this.name = 'SidecarError'; }
}
export class NotConnectedError extends Error {
  constructor(agentUrl: string) { super(`No WebSocket connection for ${agentUrl}`); this.name = 'NotConnectedError'; }
}

interface Conn { ws: WebSocket; agentUrl: string; version: ProtocolVersion }
interface Pending { resolve: (r: ResultFrame) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; agentUrl: string }

const ALIVE = Symbol('alive');
const MISSES = Symbol('misses');
const SUPERSEDED_AT = Symbol('supersededAt');
type Tagged = WebSocket & { [ALIVE]?: boolean; [MISSES]?: number; [SUPERSEDED_AT]?: number };

const log = (lvl: 'info' | 'warn', msg: string, extra?: Record<string, unknown>) =>
  console[lvl](`[relay] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`);

function closeSocket(ws: WebSocket, code: number, reason: string): void {
  try { ws.close(code, reason); } catch { /* already closing */ }
  setTimeout(() => { if (ws.readyState !== WebSocket.CLOSED) { try { ws.terminate(); } catch { /* ignore */ } } }, 5_000).unref?.();
}

function peerIp(req: IncomingMessage): string | null {
  const a = req.socket?.remoteAddress;
  return a ? a.replace(/^::ffff:/, '') : null;
}

export class SidecarRelay {
  readonly wss: WebSocketServer;
  private conns = new Map<string, Conn>();
  private pending = new Map<string, Pending>();
  private counter = 0;
  private sweep: ReturnType<typeof setInterval>;
  private o: Required<Omit<RelayOptions, 'onSeen' | 'host' | 'endpoints'>> & Pick<RelayOptions, 'onSeen' | 'host'> & { endpoints: PublicEndpoint[] };

  constructor(opts: RelayOptions = {}) {
    this.o = {
      port: opts.port ?? 3002, host: opts.host, token: opts.token ?? null,
      registerTimeoutMs: opts.registerTimeoutMs ?? 30_000, sweepMs: opts.sweepMs ?? 30_000,
      supersededGraceMs: opts.supersededGraceMs ?? 45_000, pingMissTolerance: opts.pingMissTolerance ?? 3,
      publicUrl: opts.publicUrl ?? null, onSeen: opts.onSeen,
      endpoints: opts.endpoints ?? endpointsFromEnv(),
    };
    this.wss = new WebSocketServer({
      port: this.o.port, host: this.o.host, path: WS_PATH, maxPayload: 8 * 1024 * 1024,
      verifyClient: (info, cb) => {
        if (!this.o.token) return cb(true);
        const auth = info.req.headers.authorization ?? '';
        if (auth === `Bearer ${this.o.token}`) return cb(true);
        log('warn', 'refused sidecar connection: bad or missing bearer token', { ip: peerIp(info.req) });
        cb(false, 401, 'Unauthorized');
      },
    });
    this.wss.on('connection', (ws, req) => this.onConnection(ws as Tagged, req));
    this.wss.on('error', (e) => log('warn', `server error: ${e.message}`));
    this.sweep = setInterval(() => this.runSweep(), this.o.sweepMs);
    this.sweep.unref?.();
  }

  /** Bound port (useful when port 0 was asked for in tests). */
  port(): number {
    const a = this.wss.address();
    return typeof a === 'object' && a ? a.port : this.o.port;
  }

  private onConnection(ws: Tagged, req: IncomingMessage): void {
    const version = protocolVersionOf(req.headers);
    const ip = peerIp(req);
    const hostHeader = typeof req.headers.host === 'string' ? req.headers.host : null;
    let registeredUrl: string | null = null;
    ws[ALIVE] = true; ws[MISSES] = 0;
    const alive = () => { ws[ALIVE] = true; ws[MISSES] = 0; };
    ws.on('pong', alive);

    let regTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      regTimer = null;
      if (!registeredUrl) { log('warn', 'closing socket that did not register in time', { ip }); closeSocket(ws, 1002, 'register-timeout'); }
    }, this.o.registerTimeoutMs);
    regTimer.unref?.();
    const clearReg = () => { if (regTimer) { clearTimeout(regTimer); regTimer = null; } };

    ws.on('message', async (raw) => {
      alive();
      const p = parseSidecarFrame(raw as Buffer);
      if (!p.ok) { log('warn', `bad frame: ${p.error}`, { ip }); return; }
      const f = p.frame;

      if (f.type === 'register') {
        const url = normalizeUrl(f.agentUrl);
        // Same socket re-registers under a new address (DHCP move): re-key, refuse if taken.
        if (registeredUrl && registeredUrl !== url && this.conns.get(registeredUrl)?.ws === ws) {
          const occupant = this.conns.get(url);
          if (occupant && occupant.ws !== ws) {
            ws.send(JSON.stringify({ type: 'registered', ok: false, error: `address-conflict: ${url} is already registered` }));
            return;
          }
          this.conns.delete(registeredUrl);
          const old = store.get(registeredUrl);
          store.update(registeredUrl, (s) => { s.connected = false; });
          if (old) store.update(url, (s) => { s.hostId = old.hostId; });
          log('info', 'sidecar address moved', { from: registeredUrl, to: url });
        }
        registeredUrl = url;
        clearReg();
        const prev = this.conns.get(url);
        if (prev && prev.ws !== ws) {
          const t = prev.ws as Tagged;
          if (this.o.supersededGraceMs === 0) closeSocket(t, 1012, 'superseded-by-new-registration');
          else if (t[SUPERSEDED_AT] === undefined) t[SUPERSEDED_AT] = Date.now();
        }
        this.conns.set(url, { ws, agentUrl: url, version });
        const now = Date.now();
        const s = store.update(url, (s) => {
          s.connected = true; s.transport = 'ws'; s.protocolVersion = version; s.connectedAt = now; s.lastHeartbeatAt = now;
          s.observedFromIp = ip; if (f.hostname) s.hostname = f.hostname;
          if (Array.isArray(f.containers)) s.containers = f.containers.filter((c): c is string => typeof c === 'string');
        });
        log('info', 'sidecar registered', { agentUrl: url, hostname: f.hostname, protocol: version });
        await this.seen(s, 'register');
        ws.send(JSON.stringify({ type: 'registered', ok: true }));
        if (this.o.publicUrl && ws.readyState === WebSocket.OPEN) {
          const wsPort = this.advertisedWsPort({ sourceIp: ip, hostHeader, agentUrl: url });
          const id = { type: 'master-identity', canonicalUrl: normalizeUrl(this.o.publicUrl), ...(wsPort ? { wsPort } : {}), name: 'sidecarmaster', pushedAt: Date.now() } as MasterIdentityFrame;
          ws.send(JSON.stringify(id));
        }
        store.emit('register', store.get(url) ?? s);
        return;
      }

      if (f.type === 'heartbeat') {
        if (!registeredUrl || this.conns.get(registeredUrl)?.ws !== ws) return;
        const s = store.update(registeredUrl, (s) => {
          s.lastHeartbeatAt = Date.now(); s.connected = true; s.transport = 'ws';
          if (Array.isArray(f.containers)) s.containers = f.containers.filter((c): c is string => typeof c === 'string');
          if (typeof f.activeRequests === 'number') s.activeRequests = f.activeRequests;
          store.applyStatusData(s, f.statusData);
        });
        await this.seen(s, 'heartbeat');
        store.emit('heartbeat', store.get(registeredUrl) ?? s);
        return;
      }

      if (f.type === 'result') {
        const pend = this.pending.get(f.id);
        if (!pend) return;
        clearTimeout(pend.timer);
        this.pending.delete(f.id);
        if (f.error) pend.reject(new SidecarError(f.error)); else pend.resolve(f);
        return;
      }
      // masters-ack (v2): nothing to do until Phase 4 sends `masters`.
    });

    ws.on('close', () => {
      clearReg();
      if (!registeredUrl || this.conns.get(registeredUrl)?.ws !== ws) return; // superseded socket
      this.conns.delete(registeredUrl);
      for (const [id, p] of this.pending) {
        if (p.agentUrl === registeredUrl) { clearTimeout(p.timer); this.pending.delete(id); p.reject(new NotConnectedError(registeredUrl)); }
      }
      const s = store.update(registeredUrl, (s) => { s.connected = false; });
      log('info', 'sidecar disconnected', { agentUrl: registeredUrl });
      store.emit('disconnect', s);
    });
    ws.on('error', (e) => log('warn', `socket error: ${e.message}`));
  }

  /**
   * WS port to tell this sidecar. Never the bound port when endpoints are configured: in the
   * container it is 3002, and on the LAN host port 3002 is Sound Suite's relay.
   */
  advertisedWsPort(r: { sourceIp: string | null; hostHeader: string | null; agentUrl: string }): number | null {
    if (!this.o.endpoints.length) return this.port();
    const e = chooseEndpoint(this.o.endpoints, r);
    log('info', e ? `advertise wsPort ${e.wsPort} (${e.cidr} by ${e.matchedBy})` : 'no public endpoint matches; master-identity without wsPort', { agentUrl: r.agentUrl, ip: r.sourceIp, host: r.hostHeader });
    return e ? e.wsPort : null;
  }

  private async seen(s: store.LiveHostStatus, kind: 'register' | 'heartbeat') {
    if (!this.o.onSeen) return;
    try {
      const id = await this.o.onSeen(s, kind);
      if (id) store.update(s.agentUrl, (x) => { x.hostId = id; });
    } catch (e) { log('warn', `host link failed: ${e instanceof Error ? e.message : e}`, { agentUrl: s.agentUrl }); }
  }

  runSweep(): void {
    const now = Date.now();
    for (const c of this.wss.clients) {
      const t = c as Tagged;
      if (t[SUPERSEDED_AT] !== undefined && now - t[SUPERSEDED_AT]! > this.o.supersededGraceMs) { t.terminate(); continue; }
      if (t[ALIVE] !== true) {
        t[MISSES] = (t[MISSES] ?? 0) + 1;
        if (t[MISSES]! >= this.o.pingMissTolerance) { log('warn', 'terminating unresponsive sidecar socket'); t.terminate(); continue; }
      } else t[ALIVE] = false;
      try { t.ping(); } catch { /* ignore */ }
    }
  }

  isConnected(agentUrl: string): boolean {
    const c = this.conns.get(normalizeUrl(agentUrl));
    return !!c && c.ws.readyState === WebSocket.OPEN;
  }

  connectedUrls(): string[] {
    return [...this.conns.keys()].filter((u) => this.isConnected(u));
  }

  /** Send a command frame; resolves with the sidecar's `result` frame. */
  send(agentUrl: string, action: string, payload: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<ResultFrame> {
    const url = normalizeUrl(agentUrl);
    const c = this.conns.get(url);
    if (!c || c.ws.readyState !== WebSocket.OPEN) return Promise.reject(new NotConnectedError(url));
    const id = `sm-${Date.now()}-${++this.counter}`;
    const frame: CommandFrame = { ...payload, type: 'command', id, action: `/${action.replace(/^\//, '')}` };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Command ${action} to ${url} timed out after ${timeoutMs}ms`)); }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, agentUrl: url });
      try { c.ws.send(JSON.stringify(frame)); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e as Error); }
    });
  }

  async close(): Promise<void> {
    clearInterval(this.sweep);
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('relay shutting down')); this.pending.delete(id); }
    for (const c of this.wss.clients) closeSocket(c, 1001, 'relay-shutting-down');
    for (const url of this.conns.keys()) store.update(url, (s) => { s.connected = false; });
    this.conns.clear();
    await new Promise<void>((r) => this.wss.close(() => r()));
  }
}

// ─── process singleton ────────────────────────────────────────────────────
const g = globalThis as unknown as { __smRelay?: SidecarRelay | null };

export function getRelay(): SidecarRelay | null { return g.__smRelay ?? null; }

export function startRelay(opts: RelayOptions): SidecarRelay {
  if (g.__smRelay) return g.__smRelay;
  g.__smRelay = new SidecarRelay(opts);
  return g.__smRelay;
}

export async function stopRelay(): Promise<void> {
  const r = g.__smRelay;
  g.__smRelay = null;
  if (r) await r.close();
}
