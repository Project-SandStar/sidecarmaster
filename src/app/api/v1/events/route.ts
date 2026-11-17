import { NextResponse } from 'next/server';
import { requireScope } from '@/lib/control/tokens';
import { subscribe } from '@/lib/control/events';

export const dynamic = 'force-dynamic';

/** SSE stream of fleet events (?app=<id>). App tokens see only their own app plus fleet-wide events. */
export async function GET(req: Request) {
  const want = new URL(req.url).searchParams.get('app');
  const c = await requireScope(req, 'fleet:read', want ?? undefined);
  if (c instanceof NextResponse) return c;
  const appId = 'appId' in c ? c.appId : want;
  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(ctl) {
      const send = (s: string) => { try { ctl.enqueue(enc.encode(s)); } catch { stop(); } };
      send(`event: hello\ndata: ${JSON.stringify({ app: appId ?? null })}\n\n`);
      const off = subscribe((e) => {
        if (appId && e.appId && e.appId !== appId) return;
        send(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      });
      const ping = setInterval(() => send(': ping\n\n'), 25_000);
      stop = () => { off(); clearInterval(ping); };
      req.signal?.addEventListener('abort', () => { stop(); try { ctl.close(); } catch { /* closed */ } });
    },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
}
