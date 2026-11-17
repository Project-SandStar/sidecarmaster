/** Task 5.5: Prometheus text format (version 0.0.4). */
import type { HostLive } from '../fleet/interfaces';
import { vramOf } from './samples';

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
const labels = (l: Record<string, string>) => `{${Object.entries(l).map(([k, v]) => `${k}="${esc(v)}"`).join(',')}}`;

export interface MetricsInput {
  hosts: HostLive[]; apps: { appId: string; ok: boolean }[];
  alerts: { open: number; ack: number }; releases: { product: string; platform: string; channel: string; build: number }[];
  now: number;
}

export function renderMetrics(m: MetricsInput): string {
  const out: string[] = [];
  const metric = (name: string, help: string, rows: [Record<string, string>, number][]) => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
    for (const [l, v] of rows) out.push(`${name}${Object.keys(l).length ? labels(l) : ''} ${Number.isFinite(v) ? v : 'NaN'}`);
  };
  const H = (h: HostLive) => ({ host: h.name, host_id: h.hostId });
  metric('sidecarmaster_host_up', 'Host sidecar sends heartbeats (1) or not (0).', m.hosts.map((h) => [H(h), h.online ? 1 : 0]));
  metric('sidecarmaster_host_heartbeat_age_seconds', 'Seconds since the last heartbeat.',
    m.hosts.filter((h) => h.lastHeartbeatAt).map((h) => [H(h), Math.round((m.now - h.lastHeartbeatAt!.getTime()) / 1000)]));
  metric('sidecarmaster_host_active_requests', 'Active requests on the host.',
    m.hosts.filter((h) => typeof h.activeRequests === 'number').map((h) => [H(h), h.activeRequests!]));
  metric('sidecarmaster_host_vram_used_mb', 'GPU memory used (MB), all GPUs.', m.hosts.flatMap((h) => { const v = vramOf(h); return v ? [[H(h), v.used] as [Record<string, string>, number]] : []; }));
  metric('sidecarmaster_host_vram_total_mb', 'GPU memory total (MB), all GPUs.', m.hosts.flatMap((h) => { const v = vramOf(h); return v ? [[H(h), v.total] as [Record<string, string>, number]] : []; }));
  metric('sidecarmaster_host_disk_free_percent', 'Free disk (%).',
    m.hosts.filter((h) => typeof h.diskFreePct === 'number').map((h) => [H(h), h.diskFreePct!]));
  metric('sidecarmaster_host_containers_running', 'Containers in state running.',
    m.hosts.map((h) => [H(h), (h.containers ?? []).filter((c) => c.state === 'running').length]));
  metric('sidecarmaster_host_sidecar_info', 'Sidecar version per product (value is always 1).',
    m.hosts.flatMap((h) => Object.entries(h.versions ?? {}).map(([p, v]) => [{ ...H(h), product: p, version: v }, 1] as [Record<string, string>, number])));
  metric('sidecarmaster_app_up', 'App health probe answers 2xx (1) or not (0).', m.apps.map((a) => [{ app: a.appId }, a.ok ? 1 : 0]));
  metric('sidecarmaster_alerts', 'Alerts by state.', [[{ state: 'open' }, m.alerts.open], [{ state: 'ack' }, m.alerts.ack]]);
  metric('sidecarmaster_release_latest_build', 'Newest build in the update feed.',
    m.releases.map((r) => [{ product: r.product, platform: r.platform, channel: r.channel }, r.build]));
  return out.join('\n') + '\n';
}
