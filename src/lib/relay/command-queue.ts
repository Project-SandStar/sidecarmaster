/**
 * Command delivery (from Sound Suite's command-queue.ts). WS first; if the sidecar has no
 * open socket (or the WS send fails for transport reasons), queue the command in the DB
 * and wait for the sidecar's HTTP poll + result POST.
 */
import { prisma } from '../db';
import { normalizeUrl } from '../protocol';
import { getRelay, SidecarError } from './server';

interface Waiter { resolve: (r: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
const g = globalThis as unknown as { __smCmdWaiters?: Map<string, Waiter> };
const waiters: Map<string, Waiter> = (g.__smCmdWaiters ??= new Map());

export interface QueueOptions { hostId?: string | null; appId?: string; requestedBy?: string | null; timeoutMs?: number }

export async function queueSidecarCommand(agentUrl: string, action: string, payload: Record<string, unknown> = {}, opts: QueueOptions = {}): Promise<unknown> {
  const url = normalizeUrl(agentUrl);
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const relay = getRelay();
  if (relay?.isConnected(url)) {
    try {
      return await relay.send(url, action, payload, timeoutMs);
    } catch (e) {
      if (e instanceof SidecarError) throw e; // the sidecar said no: do not retry over HTTP
      console.warn(`[relay] WS send to ${url} failed (${e instanceof Error ? e.message : e}); using HTTP queue`);
    }
  }
  const cmd = await prisma.command.create({
    data: {
      sidecarUrl: url, hostId: opts.hostId ?? null, appId: opts.appId ?? 'sidecarmaster', requestedBy: opts.requestedBy ?? null,
      action: action.replace(/^\//, ''), payload: JSON.stringify(payload), expiresAt: new Date(Date.now() + timeoutMs),
    },
  });
  return waitForResult(cmd.id, timeoutMs);
}

function waitForResult(id: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(async () => {
      waiters.delete(id);
      try { await prisma.command.update({ where: { id }, data: { status: 'expired' } }); } catch { /* best effort */ }
      reject(new Error(`Command ${id} timed out after ${timeoutMs}ms (sidecar did not poll in time)`));
    }, timeoutMs);
    timer.unref?.();
    waiters.set(id, { resolve, reject, timer });
  });
}

/** Sidecar HTTP poll: pending, unexpired commands for this URL; marks them delivered. */
export async function fetchPendingCommands(agentUrl: string): Promise<Array<{ id: string; action: string; payload: unknown }>> {
  const rows = await prisma.command.findMany({
    where: { sidecarUrl: normalizeUrl(agentUrl), status: 'pending', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'asc' }, take: 10,
  });
  if (rows.length) await prisma.command.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: 'delivered' } });
  return rows.map((r) => {
    let payload: unknown = {};
    try { payload = JSON.parse(r.payload); } catch { /* keep {} */ }
    return { id: r.id, action: r.action, payload };
  });
}

/** Sidecar HTTP result. Returns true if a caller was still waiting. */
export async function reportCommandResult(id: string, result: unknown, error?: string): Promise<boolean> {
  const row = await prisma.command.findUnique({ where: { id } });
  if (!row) return false;
  await prisma.command.update({ where: { id }, data: { status: error ? 'failed' : 'completed', result: JSON.stringify(error ? { error } : result ?? null) } });
  const w = waiters.get(id);
  if (!w) return false;
  clearTimeout(w.timer);
  waiters.delete(id);
  if (error) w.reject(new SidecarError(error)); else w.resolve(result);
  return true;
}

/** Mark old pending/delivered rows expired; delete finished rows older than a day. */
export async function cleanupCommands(now = new Date()): Promise<void> {
  await prisma.command.updateMany({ where: { status: { in: ['pending', 'delivered'] }, expiresAt: { lt: now } }, data: { status: 'expired' } });
  await prisma.command.deleteMany({ where: { status: { in: ['completed', 'failed', 'expired'] }, updatedAt: { lt: new Date(now.getTime() - 86_400_000) } } });
}
