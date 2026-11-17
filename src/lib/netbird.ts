/**
 * Settings > NetBird. Ported from mcpfantom src/admin/netbirdRoutes.ts.
 * Writes $NETBIRD_CTL_DIR/config.json (0600), read by docker/netbird-entrypoint.sh
 * and docker/caddy-entrypoint.sh. Reads status.json and caddy-status.json.
 * The setup key and the Cloudflare token never leave the server: views give hasKey/hasToken + last 4.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CTL_DIR = '/netbird-ctl';
export const DEFAULT_MANAGEMENT_URL = 'https://api.netbird.io:443';
export const DEFAULT_HOSTNAME = 'sidecarmaster';
export const DEFAULT_HTTPS_DOMAIN = 'netbird.cloud';
export const STATUS_STALE_MS = 60_000;

export interface HttpsConfig { enabled: boolean; domain: string; cloudflareToken: string; email: string }
/** Key order matters: netbird-entrypoint.sh reads top-level fields with sed. */
export interface NetbirdConfig {
  setupKey: string; hostname: string; managementUrl: string; wireguardPort: number;
  /** netbird up --external-ip-map, e.g. "99.92.186.153". Empty = not set. */
  externalIpMap: string;
  enabled: boolean; https: HttpsConfig; updatedAt: string;
}
export interface CaddyStatus {
  running: boolean; certificate: { names: string[]; notAfter: string | null } | null;
  error: string | null; updatedAt: string | null; stale: boolean;
}
export interface NetbirdStatus {
  connected: boolean; fqdn: string | null; ip: string | null;
  peersConnected: number; peersTotal: number; updatedAt: string | null;
}
export interface NetbirdView {
  configured: boolean; enabled: boolean; hostname: string; managementUrl: string;
  hasKey: boolean; keyHint: string | null; wireguardPort: number; externalIpMap: string; status: NetbirdStatus | null;
  https: {
    enabled: boolean; domain: string; email: string; hasToken: boolean; tokenHint: string | null;
    address: string; status: CaddyStatus | null;
  };
}
export interface NetbirdUpdate {
  setupKey?: unknown; hostname?: unknown; managementUrl?: unknown; wireguardPort?: unknown; externalIpMap?: unknown; enabled?: unknown;
  https?: { enabled?: unknown; domain?: unknown; cloudflareToken?: unknown; email?: unknown } | unknown;
}

export class NetbirdError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;
const EMAIL_RE = /^[^\s@"'\\]+@[^\s@"'\\]+\.[^\s@"'\\]+$/;

export const validHostname = (h: unknown): h is string => typeof h === 'string' && HOSTNAME_RE.test(h);
export const validDomain = (d: unknown): d is string => typeof d === 'string' && DOMAIN_RE.test(d);
export const validWireguardPort = (p: unknown): p is number =>
  typeof p === 'number' && Number.isInteger(p) && p >= 0 && p <= 65535;
const IPV4 = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}';
const IP_MAP_ENTRY_RE = new RegExp(`^${IPV4}(/(${IPV4}|[A-Za-z0-9_.-]{1,15}))?$`);
/** "" or a comma list of IP, IP/localIP or IP/interface (netbird up --external-ip-map). */
export const validExternalIpMap = (m: unknown): m is string =>
  typeof m === 'string' && m.length <= 500 && (m === '' || m.split(',').every((e) => IP_MAP_ENTRY_RE.test(e)));
export function validManagementUrl(u: unknown): u is string {
  if (typeof u !== 'string' || !u.trim()) return false;
  try { const x = new URL(u.trim()); return x.protocol === 'https:' && !!x.hostname; } catch { return false; }
}
export const keyHint = (k: string): string | null => (k ? k.slice(-4) : null);

export function parseNetbirdStatus(raw: unknown, mtimeMs: number | null, now: number): NetbirdStatus | null {
  if (!isObj(raw)) return null;
  const ip = typeof raw.netbirdIp === 'string' && raw.netbirdIp ? raw.netbirdIp.split('/')[0] : null;
  const fqdn = typeof raw.fqdn === 'string' && raw.fqdn ? raw.fqdn : null;
  const mgmtUp = isObj(raw.management) && raw.management.connected === true;
  const fresh = mtimeMs !== null && now - mtimeMs <= STATUS_STALE_MS;
  const peers = isObj(raw.peers) ? raw.peers : {};
  return {
    connected: mgmtUp && !!ip && fresh, fqdn, ip,
    peersConnected: Number(peers.connected) || 0, peersTotal: Number(peers.total) || 0,
    updatedAt: mtimeMs !== null ? new Date(mtimeMs).toISOString() : null,
  };
}

export function parseCaddyStatus(raw: unknown, mtimeMs: number | null, now: number): CaddyStatus | null {
  if (!isObj(raw)) return null;
  const stale = mtimeMs === null || now - mtimeMs > STATUS_STALE_MS;
  const c = isObj(raw.certificate) ? raw.certificate : null;
  return {
    running: raw.running === true && !stale,
    certificate: c ? {
      names: Array.isArray(c.names) ? c.names.filter((n): n is string => typeof n === 'string') : [],
      notAfter: typeof c.notAfter === 'string' && c.notAfter ? c.notAfter : null,
    } : null,
    error: typeof raw.error === 'string' && raw.error ? raw.error : null,
    updatedAt: mtimeMs !== null ? new Date(mtimeMs).toISOString() : null,
    stale,
  };
}

export interface NetbirdStoreOptions { env?: NodeJS.ProcessEnv; fallbackDir?: string; now?: () => number }

export function netbirdStore(opts: NetbirdStoreOptions = {}) {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  const fallback = opts.fallbackDir ?? path.join(/*turbopackIgnore: true*/ process.cwd(), 'data', 'netbird-ctl');

  const ctlDir = () => {
    const dir = env.NETBIRD_CTL_DIR?.trim() || DEFAULT_CTL_DIR;
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return { dir, configured: true };
    return { dir: fallback, configured: false };
  };

  const readConfig = (dir: string): NetbirdConfig => {
    let raw: unknown = null;
    try { raw = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')); } catch { /* none yet */ }
    const r = isObj(raw) ? raw : {};
    const h = isObj(r.https) ? r.https : {};
    return {
      setupKey: typeof r.setupKey === 'string' ? r.setupKey : '',
      hostname: validHostname(r.hostname) ? r.hostname : DEFAULT_HOSTNAME,
      managementUrl: validManagementUrl(r.managementUrl) ? r.managementUrl : DEFAULT_MANAGEMENT_URL,
      wireguardPort: validWireguardPort(r.wireguardPort) ? r.wireguardPort : 0,
      externalIpMap: validExternalIpMap(r.externalIpMap) ? r.externalIpMap : '',
      enabled: r.enabled === true,
      https: {
        enabled: h.enabled === true,
        domain: validDomain(h.domain) ? h.domain : DEFAULT_HTTPS_DOMAIN,
        cloudflareToken: typeof h.cloudflareToken === 'string' ? h.cloudflareToken : '',
        email: typeof h.email === 'string' ? h.email : '',
      },
      updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : '',
    };
  };

  const writeConfig = (dir: string, cfg: NetbirdConfig) => {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'config.json');
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  };

  const readJson = <T>(file: string, parse: (raw: unknown, m: number | null, n: number) => T | null): T | null => {
    try {
      const st = fs.statSync(file);
      return parse(JSON.parse(fs.readFileSync(file, 'utf8')), st.mtimeMs, now());
    } catch { return null; }
  };

  const view = (): NetbirdView => {
    const { dir, configured } = ctlDir();
    const cfg = readConfig(dir);
    return {
      configured, enabled: cfg.enabled, hostname: cfg.hostname, managementUrl: cfg.managementUrl,
      hasKey: !!cfg.setupKey, keyHint: keyHint(cfg.setupKey), wireguardPort: cfg.wireguardPort, externalIpMap: cfg.externalIpMap,
      status: configured ? readJson(path.join(dir, 'status.json'), parseNetbirdStatus) : null,
      https: {
        enabled: cfg.https.enabled, domain: cfg.https.domain, email: cfg.https.email,
        hasToken: !!cfg.https.cloudflareToken, tokenHint: keyHint(cfg.https.cloudflareToken),
        address: `https://${cfg.hostname}.${cfg.https.domain}`,
        status: configured ? readJson(path.join(dir, 'caddy-status.json'), parseCaddyStatus) : null,
      },
    };
  };

  const update = (body: unknown): NetbirdView => {
    const b = (isObj(body) ? body : {}) as Obj;
    const { dir } = ctlDir();
    const cfg = readConfig(dir);
    if (b.setupKey !== undefined) {
      if (typeof b.setupKey !== 'string' || !b.setupKey.trim()) throw new NetbirdError('Setup key must not be empty');
      if (/\s/.test(b.setupKey.trim())) throw new NetbirdError('Setup key must not contain spaces');
      cfg.setupKey = b.setupKey.trim();
    }
    if (b.hostname !== undefined) {
      const h = typeof b.hostname === 'string' ? b.hostname.trim().toLowerCase() : b.hostname;
      if (!validHostname(h)) throw new NetbirdError('Hostname must be 1-63 characters: a-z, 0-9 and "-" (not at the start or end)');
      cfg.hostname = h;
    }
    if (b.managementUrl !== undefined) {
      if (!validManagementUrl(b.managementUrl)) throw new NetbirdError('Management URL must be an https:// URL');
      cfg.managementUrl = b.managementUrl.trim();
    }
    if (b.wireguardPort !== undefined) {
      if (!validWireguardPort(b.wireguardPort)) throw new NetbirdError('WireGuard port must be a whole number from 0 to 65535 (0 = NetBird picks)');
      cfg.wireguardPort = b.wireguardPort;
    }
    if (b.externalIpMap !== undefined) {
      const m = typeof b.externalIpMap === 'string' ? b.externalIpMap.replace(/\s+/g, '') : b.externalIpMap;
      if (!validExternalIpMap(m)) throw new NetbirdError('Advertised public IP must be empty or an IPv4 address like 99.92.186.153 (or IP/local-IP, comma separated)');
      cfg.externalIpMap = m;
    }
    if (b.enabled !== undefined) {
      if (typeof b.enabled !== 'boolean') throw new NetbirdError('enabled must be true or false');
      cfg.enabled = b.enabled;
    }
    if (b.https !== undefined) {
      if (!isObj(b.https)) throw new NetbirdError('https must be an object');
      const h = b.https;
      if (h.enabled !== undefined) {
        if (typeof h.enabled !== 'boolean') throw new NetbirdError('https.enabled must be true or false');
        cfg.https.enabled = h.enabled;
      }
      if (h.domain !== undefined) {
        const d = typeof h.domain === 'string' ? h.domain.trim().toLowerCase() : h.domain;
        if (!validDomain(d)) throw new NetbirdError('Domain must be a DNS name like vpn.example.com');
        cfg.https.domain = d;
      }
      if (h.cloudflareToken !== undefined) {
        const t = typeof h.cloudflareToken === 'string' ? h.cloudflareToken.trim() : '';
        if (!TOKEN_RE.test(t)) throw new NetbirdError('Cloudflare token must be 20-200 characters: letters, digits, "-" and "_"');
        cfg.https.cloudflareToken = t;
      }
      if (h.email !== undefined) {
        const e = typeof h.email === 'string' ? h.email.trim() : null;
        if (e === null || (e !== '' && !EMAIL_RE.test(e))) throw new NetbirdError('Email must be empty or a valid address');
        cfg.https.email = e;
      }
    }
    if (cfg.enabled && !cfg.setupKey) throw new NetbirdError('Paste a setup key before you enable NetBird');
    cfg.updatedAt = new Date(now()).toISOString();
    writeConfig(dir, cfg);
    return view();
  };

  const removeKey = (): NetbirdView => {
    const { dir } = ctlDir();
    const cfg = readConfig(dir);
    cfg.setupKey = ''; cfg.enabled = false; cfg.updatedAt = new Date(now()).toISOString();
    writeConfig(dir, cfg);
    return view();
  };

  const removeToken = (): NetbirdView => {
    const { dir } = ctlDir();
    const cfg = readConfig(dir);
    cfg.https.cloudflareToken = ''; cfg.updatedAt = new Date(now()).toISOString();
    writeConfig(dir, cfg);
    return view();
  };

  return { view, update, removeKey, removeToken, ctlDir };
}
