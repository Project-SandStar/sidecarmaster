import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { handleSidecarHttp } from '@/lib/relay/http';
import { commandSender, fleetStatus } from '@/lib/fleet/interfaces';
import { V1_SIDECAR_FRAMES } from '@/lib/protocol/fixtures';

const post = (kind: 'register' | 'heartbeat' | 'poll' | 'result', body: unknown, auth?: string) =>
  handleSidecarHttp(kind, new Request(`http://x/api/admin/gpu/sidecars/${kind}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
  }));

describe('HTTP fallback', () => {
  it('register + heartbeat mark the host live; commands go through poll/result', async () => {
    const url = 'http://192.168.20.77:8098';
    expect((await post('register', { agentUrl: url, hostname: 'httpbox' })).status).toBe(200);
    expect((await post('heartbeat', { ...V1_SIDECAR_FRAMES.heartbeat.statusData, agentUrl: url, hostname: 'httpbox' })).status).toBe(200);
    expect(fleetStatus.forUrl(url)).toMatchObject({ connected: true, transport: 'http', version: '2.4.1' });
    const host = await prisma.host.findUniqueOrThrow({ where: { agentUrl: url } });

    const p = commandSender.send({ hostId: host.id }, 'status', { x: 1 }, { timeoutMs: 2000 });
    let cmds: Array<{ id: string; action: string }> = [];
    for (let i = 0; i < 50 && !cmds.length; i++) {
      cmds = (await (await post('poll', { agentUrl: url })).json()).commands;
      if (!cmds.length) await new Promise((r) => setTimeout(r, 10));
    }
    expect(cmds[0]).toMatchObject({ action: 'status', payload: { x: 1 } });
    expect(await (await post('result', { commandId: cmds[0].id, result: { ok: 1 } })).json()).toEqual({ ok: true, resolved: true });
    await expect(p).resolves.toEqual({ ok: 1 });
    expect((await prisma.command.findUniqueOrThrow({ where: { id: cmds[0].id } })).status).toBe('completed');
  });

  it('checks the sidecar token when SM_SIDECAR_TOKEN is set', async () => {
    process.env.SM_SIDECAR_TOKEN = 't1';
    try {
      expect((await post('poll', { agentUrl: 'http://a:1' })).status).toBe(401);
      expect((await post('poll', { agentUrl: 'http://a:1' }, 'Bearer t1')).status).toBe(200);
    } finally { delete process.env.SM_SIDECAR_TOKEN; }
  });

  it('rejects bad bodies and unknown hosts', async () => {
    expect((await post('heartbeat', {})).status).toBe(400);
    expect((await post('result', {})).status).toBe(400);
    await expect(commandSender.send({ hostId: 'nope' }, 'status')).rejects.toThrow('Unknown host');
  });
});
