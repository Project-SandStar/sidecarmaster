import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NetbirdError, netbirdStore, parseCaddyStatus, parseNetbirdStatus } from '@/lib/netbird';

const dir = () => process.env.NETBIRD_CTL_DIR!;

describe('NetBird settings', () => {
  it('has the defaults', () => {
    const v = netbirdStore().view();
    expect(v).toMatchObject({ configured: true, hostname: 'sidecarmaster', managementUrl: 'https://api.netbird.io:443', wireguardPort: 0, hasKey: false, enabled: false });
    expect(v.https.address).toBe('https://sidecarmaster.netbird.cloud');
  });
  it('saves key and token to config.json (0600) but never returns them', () => {
    const v = netbirdStore().update({ setupKey: 'KEY-AAAA-BBBB-1234', enabled: true, https: { enabled: true, cloudflareToken: 'cf_token_abcdefghijklmnop9876' } });
    expect(JSON.stringify(v)).not.toMatch(/KEY-AAAA|cf_token_abc/);
    expect(v.keyHint).toBe('1234');
    expect(v.https.tokenHint).toBe('9876');
    const f = path.join(dir(), 'config.json');
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
    expect(cfg.setupKey).toBe('KEY-AAAA-BBBB-1234');
    expect(cfg.https.cloudflareToken).toBe('cf_token_abcdefghijklmnop9876');
  });
  it('validates input', () => {
    const s = netbirdStore();
    expect(() => s.update({ hostname: 'Bad_Name!' })).toThrow(NetbirdError);
    expect(() => s.update({ managementUrl: 'http://x' })).toThrow(/https/);
    expect(() => s.update({ wireguardPort: 70000 })).toThrow(/WireGuard/);
    expect(() => s.update({ externalIpMap: '999.1.1.1' })).toThrow(/public IP/);
    expect(() => s.update({ externalIpMap: 'not an ip' })).toThrow(/public IP/);
    expect(() => s.update({ https: { cloudflareToken: 'short' } })).toThrow(/Cloudflare/);
  });
  it('saves the advertised public IP after wireguardPort (sed reads it as a top-level field)', () => {
    const v = netbirdStore().update({ wireguardPort: 52001, externalIpMap: ' 99.92.186.153 ' });
    expect(v).toMatchObject({ wireguardPort: 52001, externalIpMap: '99.92.186.153' });
    const raw = fs.readFileSync(path.join(dir(), 'config.json'), 'utf8');
    expect(raw).toMatch(/^  "wireguardPort": 52001,\n  "externalIpMap": "99.92.186.153",$/m);
    expect(netbirdStore().update({ externalIpMap: '1.2.3.4/10.0.0.1,5.6.7.8/eth1' }).externalIpMap).toBe('1.2.3.4/10.0.0.1,5.6.7.8/eth1');
    expect(netbirdStore().update({ externalIpMap: '' }).externalIpMap).toBe('');
  });
  it('remove key turns NetBird off', () => {
    const v = netbirdStore().removeKey();
    expect(v.hasKey).toBe(false);
    expect(v.enabled).toBe(false);
    expect(() => netbirdStore().update({ enabled: true })).toThrow(/setup key/);
  });
  it('parses status files and marks old ones stale', () => {
    const now = Date.now();
    expect(parseNetbirdStatus({ netbirdIp: '100.100.1.2/16', fqdn: 'sm.vpn.example.com', management: { connected: true }, peers: { connected: 3, total: 5 } }, now, now))
      .toMatchObject({ connected: true, ip: '100.100.1.2', peersConnected: 3 });
    expect(parseNetbirdStatus({ netbirdIp: '100.100.1.2/16', management: { connected: true } }, now - 120_000, now)?.connected).toBe(false);
    const c = parseCaddyStatus({ running: true, certificate: { names: ['sidecarmaster.vpn.example.com'], notAfter: '2027-01-01T00:00:00Z' } }, now, now);
    expect(c).toMatchObject({ running: true, stale: false, certificate: { notAfter: '2027-01-01T00:00:00Z' } });
  });
});
