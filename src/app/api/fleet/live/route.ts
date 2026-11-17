import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/session';
import { fleetRows } from '@/lib/fleet';
import { heartbeatSource } from '@/lib/fleet/interfaces';

export const dynamic = 'force-dynamic';

/**
 * Live fleet rows for admins. `?once=1` returns JSON; otherwise Server-Sent Events:
 * a `rows` event on connect, then at most one per second after any heartbeat, plus a 15 s keep-alive.
 */
export async function GET(req: Request) {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  if (new URL(req.url).searchParams.get('once') === '1') return NextResponse.json(await fleetRows());

  const enc = new TextEncoder();
  let unsub = () => {};
  let ping: ReturnType<typeof setInterval> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stream = new ReadableStream({
    async start(ctrl) {
      let closed = false;
      const close = () => { if (closed) return; closed = true; unsub(); if (ping) clearInterval(ping); if (timer) clearTimeout(timer); try { ctrl.close(); } catch { /* closed */ } };
      const push = async () => {
        timer = null;
        if (closed) return;
        try { ctrl.enqueue(enc.encode(`event: rows\ndata: ${JSON.stringify(await fleetRows())}\n\n`)); } catch { close(); }
      };
      unsub = heartbeatSource.subscribe(() => { if (!timer) timer = setTimeout(push, 1_000); });
      ping = setInterval(() => { try { ctrl.enqueue(enc.encode(': ping\n\n')); } catch { close(); } }, 15_000);
      req.signal.addEventListener('abort', close);
      await push();
    },
    cancel() { unsub(); if (ping) clearInterval(ping); if (timer) clearTimeout(timer); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
