import { describe, expect, it } from 'vitest';
import { chooseEndpoint, inCidr, parseEndpoints } from '@/lib/relay/endpoints';

const EPS = parseEndpoints(JSON.stringify([
  { cidr: '192.168.20.0/24', httpUrl: 'http://192.168.20.192:3010/', wsPort: 3012 },
  { cidr: '100.64.0.0/10', httpUrl: 'http://100.100.28.154:3010', wsPort: 3002 },
]));

describe('public endpoint chooser', () => {
  it('parses env and drops bad entries', () => {
    expect(EPS).toHaveLength(2);
    expect(EPS[0].httpUrl).toBe('http://192.168.20.192:3010');
    expect(parseEndpoints('not json')).toEqual([]);
    expect(parseEndpoints('[{"cidr":"x","httpUrl":"http://a","wsPort":1},{"cidr":"10.0.0.0/8","httpUrl":"http://a","wsPort":70000}]')).toEqual([]);
    expect(parseEndpoints(undefined)).toEqual([]);
  });

  it('matches CIDRs', () => {
    expect(inCidr('192.168.20.6', '192.168.20.0/24')).toBe(true);
    expect(inCidr('192.168.21.6', '192.168.20.0/24')).toBe(false);
    expect(inCidr('100.100.28.154', '100.64.0.0/10')).toBe(true);
    expect(inCidr('100.128.0.1', '100.64.0.0/10')).toBe(false);
    expect(inCidr('::ffff:192.168.20.6', '192.168.20.0/24')).toBe(true);
  });

  it('NetBird sidecar (real 100.x source) gets 3002', () => {
    expect(chooseEndpoint(EPS, { sourceIp: '100.100.192.119', hostHeader: '100.100.28.154:3002', agentUrl: 'http://100.100.192.119:8098' }))
      .toMatchObject({ wsPort: 3002, matchedBy: 'source' });
  });

  it('LAN sidecar behind Docker NAT (gateway source) gets 3012 from the Host header', () => {
    expect(chooseEndpoint(EPS, { sourceIp: '172.18.0.1', hostHeader: '192.168.20.192:3012', agentUrl: 'http://192.168.20.6:8098' }))
      .toMatchObject({ wsPort: 3012, httpUrl: 'http://192.168.20.192:3010', matchedBy: 'host' });
  });

  it('falls back to the agentUrl subnet, never to 3002 for a LAN sidecar', () => {
    expect(chooseEndpoint(EPS, { sourceIp: '172.18.0.1', hostHeader: 'gpuws42:3012', agentUrl: 'http://192.168.20.6:8098' }))
      .toMatchObject({ wsPort: 3012, matchedBy: 'agentUrl' });
    expect(chooseEndpoint(EPS, { sourceIp: '192.168.20.134', agentUrl: 'http://192.168.20.134:8098' })!.wsPort).toBe(3012);
  });

  it('returns null when nothing matches or no endpoints are set', () => {
    expect(chooseEndpoint(EPS, { sourceIp: '172.18.0.1', hostHeader: 'gpuws42:3012', agentUrl: 'http://gpuws34:8098' })).toBeNull();
    expect(chooseEndpoint([], { sourceIp: '192.168.20.6' })).toBeNull();
  });
});
