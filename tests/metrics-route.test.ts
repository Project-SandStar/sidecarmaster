import { describe, expect, it } from 'vitest';
import { GET } from '@/app/metrics/route';

const req = (auth?: string) => new Request('http://x/metrics', { headers: auth ? { Authorization: auth } : {} });

describe('/metrics', () => {
  it('is off without a token, 401 on a bad token, text with the right token', async () => {
    delete process.env.SM_METRICS_TOKEN;
    expect((await GET(req('Bearer x'))).status).toBe(404);
    process.env.SM_METRICS_TOKEN = 'metrics-token-test';
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req('Bearer wrong'))).status).toBe(401);
    const r = await GET(req('Bearer metrics-token-test'));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/plain; version=0.0.4/);
    expect(await r.text()).toContain('# TYPE sidecarmaster_alerts gauge');
  });
});
