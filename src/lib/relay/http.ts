/**
 * HTTP fallback for sidecars without a WebSocket (from Sound Suite's
 * /api/admin/gpu/sidecars/{register,heartbeat,poll,result} routes). Same paths and bodies.
 * Auth: if SM_SIDECAR_TOKEN is set, require `Authorization: Bearer <token>` (same as the WS relay).
 */
import { NextResponse } from 'next/server';
import { MASTER_URL_HEADER, normalizeUrl, type SidecarStatusData } from '../protocol';
import * as store from './live-store';
import { persistSeen } from './persist';
import { fetchPendingCommands, reportCommandResult } from './command-queue';

export function sidecarAuthOk(req: Request, token = process.env.SM_SIDECAR_TOKEN): boolean {
  if (!token) return true;
  return req.headers.get('authorization') === `Bearer ${token}`;
}

function ipOf(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || null;
}

function headers(): Record<string, string> {
  const u = process.env.SM_PUBLIC_URL;
  return u ? { [MASTER_URL_HEADER]: normalizeUrl(u) } : {};
}

type Kind = 'register' | 'heartbeat' | 'poll' | 'result';

export async function handleSidecarHttp(kind: Kind, req: Request): Promise<NextResponse> {
  if (!sidecarAuthOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });

  try {
    if (kind === 'result') {
      const id = body.commandId;
      if (typeof id !== 'string' || !id) return NextResponse.json({ error: 'commandId is required' }, { status: 400 });
      const resolved = await reportCommandResult(id, body.result, typeof body.error === 'string' ? body.error : undefined);
      return NextResponse.json({ ok: true, resolved });
    }

    const agentUrl = body.agentUrl;
    if (typeof agentUrl !== 'string' || !agentUrl) return NextResponse.json({ error: 'agentUrl is required' }, { status: 400 });

    if (kind === 'poll') return NextResponse.json({ commands: await fetchPendingCommands(agentUrl) });

    const now = Date.now();
    const wsOpen = store.get(agentUrl)?.transport === 'ws' && store.get(agentUrl)?.connected;
    const s = store.update(agentUrl, (s) => {
      // A live WS wins over HTTP for the transport field.
      if (!wsOpen) { s.transport = 'http'; s.connected = true; }
      s.lastHeartbeatAt = now;
      s.observedFromIp = ipOf(req) ?? s.observedFromIp;
      if (typeof body.hostname === 'string') s.hostname = body.hostname;
      if (kind === 'register') {
        if (!wsOpen) s.connectedAt = now;
        if (Array.isArray(body.containers)) s.containers = body.containers.filter((c): c is string => typeof c === 'string');
      } else {
        if (typeof body.activeRequests === 'number') s.activeRequests = body.activeRequests;
        store.applyStatusData(s, body as SidecarStatusData);
      }
    });
    try {
      const id = await persistSeen(s, kind);
      if (id) store.update(agentUrl, (x) => { x.hostId = id; });
    } catch (e) { console.warn(`[relay] host link failed for ${normalizeUrl(agentUrl)}:`, e instanceof Error ? e.message : e); }
    store.emit(kind, store.get(agentUrl) ?? s);

    if (kind === 'register') return NextResponse.json({ ok: true }, { headers: headers() });
    const commands = await fetchPendingCommands(agentUrl);
    return NextResponse.json({ ok: true, commands }, { headers: headers() });
  } catch (e) {
    return NextResponse.json({ error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }, { status: 500 });
  }
}
