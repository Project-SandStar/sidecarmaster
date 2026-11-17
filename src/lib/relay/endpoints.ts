/**
 * Per-network public endpoints: which HTTP URL and WS port to tell a sidecar.
 *
 * The relay listens on 3002 in the container, but on gpuws42 host port 3002 is Sound Suite's
 * relay, so office (LAN) sidecars reach sidecarmaster's relay on host port 3012. Telling a LAN
 * sidecar "wsPort 3002" (the bound port) makes it dial Sound Suite. So the address we advertise
 * depends on how the sidecar reached us.
 *
 *   SM_PUBLIC_ENDPOINTS='[{"cidr":"192.168.20.0/24","httpUrl":"http://192.168.20.192:3010","wsPort":3012},
 *                         {"cidr":"100.64.0.0/10","httpUrl":"http://100.100.28.154:3010","wsPort":3002}]'
 *
 * Match order: the socket's source IP (NetBird traffic arrives with the real 100.x address);
 * then the host in the Host header (the address the sidecar dialled; behind Docker NAT the source
 * is the bridge gateway); then the host of the sidecar's agentUrl. No match: null, and the caller
 * sends no port at all rather than a wrong one.
 */
export interface PublicEndpoint { cidr: string; httpUrl: string; wsPort: number }

export interface Reach { sourceIp?: string | null; hostHeader?: string | null; agentUrl?: string | null }

function ipv4(s: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s.trim().replace(/^::ffff:/, ''));
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

export function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsS] = cidr.split('/');
  const a = ipv4(ip), b = ipv4(base);
  const bits = bitsS === undefined ? 32 : Number(bitsS);
  if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

/** Host part of a Host header ("192.168.20.192:3012" → "192.168.20.192"). */
function hostOf(h: string): string {
  const s = h.trim();
  if (s.startsWith('[')) return s.slice(1, s.indexOf(']'));
  return s.split(':')[0];
}

function urlHost(u: string): string | null {
  try { return new URL(u).hostname; } catch { return null; }
}

/** Parse SM_PUBLIC_ENDPOINTS. Bad entries are dropped with a warning; bad JSON gives []. */
export function parseEndpoints(raw: string | undefined | null): PublicEndpoint[] {
  if (!raw || !raw.trim()) return [];
  let v: unknown;
  try { v = JSON.parse(raw); } catch { console.warn('[relay] SM_PUBLIC_ENDPOINTS is not valid JSON; ignored'); return []; }
  if (!Array.isArray(v)) { console.warn('[relay] SM_PUBLIC_ENDPOINTS must be a JSON array; ignored'); return []; }
  const out: PublicEndpoint[] = [];
  for (const e of v) {
    const o = e as Record<string, unknown>;
    const ok = o && typeof o.cidr === 'string' && /^[\d.]+(\/\d{1,2})?$/.test(o.cidr) && ipv4(o.cidr.split('/')[0]) !== null
      && typeof o.httpUrl === 'string' && urlHost(o.httpUrl) !== null
      && typeof o.wsPort === 'number' && Number.isInteger(o.wsPort) && o.wsPort > 0 && o.wsPort < 65536;
    if (ok) out.push({ cidr: o.cidr as string, httpUrl: (o.httpUrl as string).replace(/\/+$/, ''), wsPort: o.wsPort as number });
    else console.warn(`[relay] SM_PUBLIC_ENDPOINTS: bad entry ignored: ${JSON.stringify(e)}`);
  }
  return out;
}

/** The endpoint for a sidecar, or null when none matches. */
export function chooseEndpoint(eps: PublicEndpoint[], r: Reach): (PublicEndpoint & { matchedBy: 'source' | 'host' | 'agentUrl' }) | null {
  if (!eps.length) return null;
  const tries: ['source' | 'host' | 'agentUrl', string | null][] = [
    ['source', r.sourceIp ?? null],
    ['host', r.hostHeader ? hostOf(r.hostHeader) : null],
    ['agentUrl', r.agentUrl ? urlHost(r.agentUrl) : null],
  ];
  for (const [by, ip] of tries) {
    if (!ip || ipv4(ip) === null) continue;
    const e = eps.find((x) => inCidr(ip, x.cidr));
    if (e) return { ...e, matchedBy: by };
  }
  return null;
}

let cached: { raw: string | undefined; eps: PublicEndpoint[] } | null = null;
/** Endpoints from env (parsed once per value). */
export function endpointsFromEnv(): PublicEndpoint[] {
  const raw = process.env.SM_PUBLIC_ENDPOINTS;
  if (!cached || cached.raw !== raw) cached = { raw, eps: parseEndpoints(raw) };
  return cached.eps;
}
