import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { sha256Hex } from '@/lib/crypto';
import { getFleetStatus } from '@/lib/fleet/interfaces';
import { alertCounts } from '@/lib/alerts/engine';
import { renderMetrics } from '@/lib/monitor/metrics';

export const dynamic = 'force-dynamic';
const METRICS_TOKEN_KEY = 'metrics.token';

/** Token from env SM_METRICS_TOKEN, else from Settings (encrypted). No token set = /metrics is off. */
async function token(): Promise<string | null> {
  return process.env.SM_METRICS_TOKEN || (await getSetting(METRICS_TOKEN_KEY));
}

/** GET /metrics with `Authorization: Bearer <admin token>`. Prometheus text format. */
export async function GET(req: Request) {
  const t = await token();
  if (!t) return NextResponse.json({ error: '/metrics is off: set SM_METRICS_TOKEN or a metrics token in Settings' }, { status: 404 });
  const got = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? '';
  // Compare hashes so the check takes the same time for every wrong token length.
  if (sha256Hex(got) !== sha256Hex(t)) return NextResponse.json({ error: 'Bad token' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
  const [hosts, alerts, rel, lastAppAlerts] = await Promise.all([
    (await getFleetStatus()).list(), alertCounts(),
    prisma.release.groupBy({ by: ['product', 'platform', 'channel'], where: { rollout: 'all' }, _max: { build: true } }),
    prisma.app.findMany({ where: { enabled: true, protocol: { not: 'none' } }, select: { id: true } }),
  ]);
  const down = new Set((await prisma.alert.findMany({ where: { rule: 'app-down', hostId: null, state: { in: ['open', 'ack'] } }, select: { appId: true } })).map((a) => a.appId));
  const body = renderMetrics({
    hosts, alerts, now: Date.now(),
    apps: lastAppAlerts.map((a) => ({ appId: a.id, ok: !down.has(a.id) })),
    releases: rel.map((r) => ({ product: r.product, platform: r.platform, channel: r.channel, build: r._max.build ?? 0 })),
  });
  return new NextResponse(body, { headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' } });
}
