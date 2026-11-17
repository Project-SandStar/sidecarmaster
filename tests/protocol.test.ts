import { describe, expect, it } from 'vitest';
import { parseMasterFrame, parseSidecarFrame, protocolVersionOf, normalizeUrl } from '@/lib/protocol';
import { V1_MASTER_FRAMES, V1_SIDECAR_FRAMES, V2_MASTER_FRAMES, V2_SIDECAR_FRAMES } from '@/lib/protocol/fixtures';

describe('protocol fixtures', () => {
  for (const [name, f] of Object.entries({ ...V1_SIDECAR_FRAMES, ...prefix('v2', V2_SIDECAR_FRAMES) })) {
    it(`sidecar frame ${name} round-trips`, () => {
      const p = parseSidecarFrame(JSON.stringify(f));
      expect(p.ok).toBe(true);
      if (p.ok) expect(JSON.parse(JSON.stringify(p.frame))).toEqual(f);
      expect(parseSidecarFrame(Buffer.from(JSON.stringify(f))).ok).toBe(true);
    });
  }
  for (const [name, f] of Object.entries({ ...V1_MASTER_FRAMES, ...prefix('v2', V2_MASTER_FRAMES) })) {
    it(`master frame ${name} round-trips`, () => {
      const p = parseMasterFrame(JSON.stringify(f));
      expect(p.ok).toBe(true);
      if (p.ok) expect(JSON.parse(JSON.stringify(p.frame))).toEqual(f);
    });
  }

  it('rejects bad frames', () => {
    expect(parseSidecarFrame('not json')).toMatchObject({ ok: false });
    expect(parseSidecarFrame('[]')).toMatchObject({ ok: false });
    expect(parseSidecarFrame({ type: 'register' })).toMatchObject({ ok: false });
    expect(parseSidecarFrame({ type: 'heartbeat', statusData: 'x' })).toMatchObject({ ok: false });
    expect(parseSidecarFrame({ type: 'result' })).toMatchObject({ ok: false });
    expect(parseSidecarFrame({ type: 'nope' })).toMatchObject({ ok: false });
    expect(parseMasterFrame({ type: 'masters', rev: 1, masters: [{ appId: 'x' }] })).toMatchObject({ ok: false });
  });

  it('reads protocol version and normalizes URLs', () => {
    expect(protocolVersionOf({})).toBe(1);
    expect(protocolVersionOf({ 'x-sidecar-protocol': '2' })).toBe(2);
    expect(normalizeUrl(' http://a:8098// ')).toBe('http://a:8098');
  });
});

function prefix<T extends Record<string, unknown>>(p: string, o: T) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [`${p}.${k}`, v]));
}
