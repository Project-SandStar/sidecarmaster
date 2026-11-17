import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { prisma } from '@/lib/db';
import { SidecarRelay, SidecarError, NotConnectedError } from '@/lib/relay/server';
import * as store from '@/lib/relay/live-store';
import { persistSeen, __resetPersist } from '@/lib/relay/persist';
import { fleetStatus, heartbeatSource, type HeartbeatEvent } from '@/lib/fleet/interfaces';
import { parseMasterFrame, type MasterFrame } from '@/lib/protocol';
import { V1_SIDECAR_FRAMES } from '@/lib/protocol/fixtures';

/** Fake sidecar: speaks v1 like sideCar/src/lib/ws-client.ts. */
class FakeSidecar {
  ws: WebSocket;
  frames: MasterFrame[] = [];
  autoReply = true;
  private waiters: Array<(f: MasterFrame) => void> = [];
  constructor(port: number, headers: Record<string, string> = {}) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/sidecar`, { headers });
    this.ws.on('message', (raw) => {
      const p = parseMasterFrame(raw.toString());
      if (!p.ok) throw new Error(p.error);
      this.frames.push(p.frame);
      this.waiters.splice(0).forEach((w) => w(p.frame));
      if (this.autoReply && p.frame.type === 'command') {
        const c = p.frame;
        this.send(c.action === '/fail' ? { type: 'result', id: c.id, error: 'nope' } : { type: 'result', id: c.id, data: { echo: c.action } });
      }
    });
  }
  open() { return new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); }); }
  closed() { return new Promise<number>((res) => this.ws.once('close', (c) => res(c))); }
  send(f: unknown) { this.ws.send(JSON.stringify(f)); }
  next(type: string) {
    const have = this.frames.find((f) => f.type === type);
    if (have) { this.frames.splice(this.frames.indexOf(have), 1); return Promise.resolve(have); }
    return new Promise<MasterFrame>((res) => {
      const w = (f: MasterFrame) => { if (f.type === type) { this.frames.splice(this.frames.indexOf(f), 1); res(f); } else this.waiters.push(w); };
      this.waiters.push(w);
    });
  }
  async register(agentUrl: string, hostname: string) {
    this.send({ type: 'register', agentUrl, hostname, containers: ['ss-ocr'] });
    return this.next('registered');
  }
  close() { this.ws.close(); }
}

const until = async (fn: () => boolean | Promise<boolean>, ms = 2000) => {
  const end = Date.now() + ms;
  while (!(await fn())) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); }
};

let relays: SidecarRelay[] = [];
const mk = (o: ConstructorParameters<typeof SidecarRelay>[0] = {}) => {
  const r = new SidecarRelay({ port: 0, host: '127.0.0.1', publicUrl: 'https://sidecarmaster.test', onSeen: (s, k) => persistSeen(s, k), ...o });
  relays.push(r);
  return new Promise<SidecarRelay>((res) => (r.wss.address() ? res(r) : r.wss.once('listening', () => res(r))));
};

beforeEach(async () => {
  for (const r of relays) await r.close();
  relays = [];
  store.__resetLiveStore();
  __resetPersist();
  await prisma.hostAlias.deleteMany();
  await prisma.command.deleteMany();
  await prisma.host.deleteMany();
});
afterAll(async () => { for (const r of relays) await r.close(); });

describe('sidecar relay', () => {
  it('v1 sidecar registers, gets master-identity, heartbeats, and is linked to a host', async () => {
    const relay = await mk();
    const events: HeartbeatEvent[] = [];
    const unsub = heartbeatSource.subscribe((e) => events.push(e));
    const sc = new FakeSidecar(relay.port());
    await sc.open();
    expect(await sc.register('http://192.168.20.6:8098/', 'GPUWS34.local')).toEqual({ type: 'registered', ok: true });
    expect(await sc.next('master-identity')).toMatchObject({ canonicalUrl: 'https://sidecarmaster.test', wsPort: relay.port() });
    sc.send({ ...V1_SIDECAR_FRAMES.heartbeat });
    await until(() => events.some((e) => e.kind === 'heartbeat'));
    unsub();

    const st = fleetStatus.forUrl('http://192.168.20.6:8098')!;
    expect(st).toMatchObject({ connected: true, transport: 'ws', protocolVersion: 1, version: '2.4.1', activeRequests: 2 });
    expect(st.gpus[0].name).toBe('NVIDIA RTX 4090');
    const host = await prisma.host.findUniqueOrThrow({ where: { agentUrl: 'http://192.168.20.6:8098' }, include: { aliases: true } });
    expect(host).toMatchObject({ hostname: 'gpuws34', source: 'relay', sidecarVersion: '2.4.1' });
    expect(host.aliases.map((a) => a.url)).toEqual(['http://192.168.20.6:8098']);
    expect(fleetStatus.forHost(host.id)?.agentUrl).toBe('http://192.168.20.6:8098');
    expect(fleetStatus.isConnected({ hostId: host.id })).toBe(true);

    sc.close();
    await until(() => !fleetStatus.forUrl('http://192.168.20.6:8098')!.connected);
    expect(events.map((e) => e.kind)).toContain('register');
  });

  it('sends commands and returns results or SidecarError', async () => {
    const relay = await mk();
    const sc = new FakeSidecar(relay.port());
    await sc.open();
    await sc.register('http://192.168.20.5:8098', 'box5');
    expect(await relay.send('http://192.168.20.5:8098', 'status')).toMatchObject({ type: 'result', data: { echo: '/status' } });
    await expect(relay.send('http://192.168.20.5:8098', 'fail')).rejects.toBeInstanceOf(SidecarError);
    await expect(relay.send('http://10.99.0.1:8098', 'status')).rejects.toBeInstanceOf(NotConnectedError);
    sc.autoReply = false;
    await expect(relay.send('http://192.168.20.5:8098', 'status', {}, 50)).rejects.toThrow(/timed out/);
    sc.close();
  });

  it('same box under a second URL becomes one host with two aliases', async () => {
    const relay = await mk();
    const a = new FakeSidecar(relay.port()); await a.open();
    await a.register('http://192.168.88.238:8098', 'macmini');
    const b = new FakeSidecar(relay.port()); await b.open();
    await b.register('http://100.100.220.200:8098', 'MacMini.local');
    expect(await prisma.host.count()).toBe(1);
    const h = await prisma.host.findFirstOrThrow({ include: { aliases: true } });
    expect(h.aliases.map((x) => x.url).sort()).toEqual(['http://100.100.220.200:8098', 'http://192.168.88.238:8098']);
    expect(h.agentUrl).toBe('http://100.100.220.200:8098');
    a.close(); b.close();
  });

  it('keeps a superseded socket open for the grace, then reaps it (no reconnect loop)', async () => {
    const relay = await mk({ supersededGraceMs: 30 });
    const old = new FakeSidecar(relay.port()); await old.open();
    await old.register('http://192.168.20.134:8098', 'gpu1');
    const fresh = new FakeSidecar(relay.port()); await fresh.open();
    await fresh.register('http://192.168.20.134:8098', 'gpu1');
    relay.runSweep();
    expect(old.ws.readyState).toBe(WebSocket.OPEN);
    await new Promise((r) => setTimeout(r, 50));
    const closed = old.closed();
    relay.runSweep();
    await closed;
    // The superseded socket closing does not mark the host offline.
    expect(fleetStatus.forUrl('http://192.168.20.134:8098')!.connected).toBe(true);
    expect(relay.isConnected('http://192.168.20.134:8098')).toBe(true);
    fresh.close();
  });

  it('refuses an address move onto a URL another socket holds', async () => {
    const relay = await mk();
    const a = new FakeSidecar(relay.port()); await a.open();
    await a.register('http://10.0.0.1:8098', 'a');
    const b = new FakeSidecar(relay.port()); await b.open();
    await b.register('http://10.0.0.2:8098', 'b');
    const r = await b.register('http://10.0.0.1:8098', 'b');
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/address-conflict/);
    a.close(); b.close();
  });

  it('closes sockets that do not register in time', async () => {
    const relay = await mk({ registerTimeoutMs: 30 });
    const sc = new FakeSidecar(relay.port()); await sc.open();
    expect(await sc.closed()).toBe(1002);
  });

  it('requires the bearer token when one is set', async () => {
    const relay = await mk({ token: 'tok-test' });
    const bad = new FakeSidecar(relay.port());
    await expect(bad.open()).rejects.toThrow(/401/);
    const good = new FakeSidecar(relay.port(), { Authorization: 'Bearer tok-test' });
    await good.open();
    expect(await good.register('http://10.0.0.9:8098', 'n9')).toMatchObject({ ok: true });
    good.close();
  });

  it('reads protocol v2 from the header', async () => {
    const relay = await mk();
    const sc = new FakeSidecar(relay.port(), { 'X-Sidecar-Protocol': '2' }); await sc.open();
    await sc.register('http://10.0.0.8:8098', 'n8');
    expect(fleetStatus.forUrl('http://10.0.0.8:8098')!.protocolVersion).toBe(2);
    sc.close();
  });

  it('advertises the wsPort for the sidecar network, never the bound port', async () => {
    const endpoints = [
      { cidr: '192.168.20.0/24', httpUrl: 'http://192.168.20.192:3010', wsPort: 3012 },
      { cidr: '100.64.0.0/10', httpUrl: 'http://100.100.28.154:3010', wsPort: 3002 },
    ];
    const relay = await mk({ endpoints });
    // Source is 127.0.0.1 (no match); the Host header says the LAN address the sidecar dialled.
    const lan = new FakeSidecar(relay.port(), { Host: '192.168.20.192:3012' });
    await lan.open();
    await lan.register('http://192.168.20.6:8098', 'GPUWS34');
    expect(await lan.next('master-identity')).toMatchObject({ wsPort: 3012 });
    lan.close();
    // Host header does not match: the agentUrl subnet decides.
    const nb = new FakeSidecar(relay.port());
    await nb.open();
    await nb.register('http://100.100.192.119:8098', 'mcpserver');
    expect(await nb.next('master-identity')).toMatchObject({ wsPort: 3002 });
    nb.close();
    // Nothing matches: no wsPort at all.
    const other = new FakeSidecar(relay.port());
    await other.open();
    await other.register('http://gpuws99:8098', 'x');
    const f = await other.next('master-identity');
    expect(f).not.toHaveProperty('wsPort');
    other.close();
  });
});
