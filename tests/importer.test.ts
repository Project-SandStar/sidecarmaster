import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { IGNORE_URLS_KEY, importSoundSuite } from '@/lib/importer/run';
import { setSetting } from '@/lib/settings';
import { buildPlan } from '@/lib/importer/plan';
import { readSnapshot } from '@/lib/importer/snapshot';
import { makeSoundSuiteDb } from './fixtures';

describe('Sound Suite importer', () => {
  const ss = makeSoundSuiteDb();

  it('reads Sound Suite without writing to it', () => {
    const before = fs.readFileSync(ss);
    const s = readSnapshot(ss);
    expect(s.provisioning).toHaveLength(2);
    expect(s.assignments).toHaveLength(3);
    expect(s.sidecars).toHaveLength(3);
    expect(s.openCommands).toBe(1);
    expect(fs.readFileSync(ss).equals(before)).toBe(true);
  });

  it('merges two URLs with the same hostname into one host with aliases', () => {
    const p = buildPlan(readSnapshot(ss));
    expect(p.hosts).toHaveLength(2);
    expect(p.warnings.some((w) => w.includes('Merged 2 URLs of host "gpuws34"'))).toBe(true);
    const b = p.hosts.find((h) => h.hostname === 'gpuws34')!;
    expect(b.agentUrl).toBe('http://192.168.20.6:8098'); // the connected one
    expect(b.aliases.sort()).toEqual(['http://192.168.20.6:8098', 'http://192.168.88.242:8098']);
    expect(p.roles.filter((r) => r.agentUrl === b.agentUrl).map((r) => r.mode).sort()).toEqual(['ss-ocr', 'ss-reranker']);
  });

  it('dry run writes nothing', async () => {
    const r = await importSoundSuite({ systemDb: ss }, true);
    expect(r.hosts.created).toBe(2);
    expect(await prisma.host.count()).toBe(0);
    expect(await prisma.app.count()).toBe(0);
  });

  it('real run creates rows; a second run gives the same rows', async () => {
    const r1 = await importSoundSuite({ systemDb: ss }, false);
    expect(r1).toMatchObject({ hosts: { created: 2 }, aliases: { created: 3 }, roles: { created: 3 }, hostApps: { created: 2 } });
    expect(r1.apps.created).toBeGreaterThanOrEqual(6);
    const snap = async () => JSON.stringify({
      h: await prisma.host.findMany({ orderBy: { agentUrl: 'asc' }, select: { name: true, agentUrl: true, hostOsOverride: true, netbirdIp: true, note: true } }),
      r: await prisma.roleAssignment.findMany({ orderBy: { mode: 'asc' }, select: { mode: true, enabled: true, minOnline: true, idleTimeoutMin: true, modelOverride: true, runtime: true } }),
      p: await prisma.hostApp.findMany({ orderBy: { masterUrlOverride: 'asc' }, select: { appId: true, masterUrlOverride: true, wsPortOverride: true } }),
    });
    const a = await snap();
    const r2 = await importSoundSuite({ systemDb: ss }, false);
    expect(r2).toMatchObject({ hosts: { created: 0, updated: 0, merged: 0 }, aliases: { created: 0 }, roles: { created: 0, updated: 0 }, hostApps: { created: 0, updated: 0 } });
    expect(await snap()).toBe(a);
    const mcp = await prisma.host.findUniqueOrThrow({ where: { agentUrl: 'http://100.100.192.119:8098' }, include: { apps: true } });
    expect(mcp).toMatchObject({ name: 'mcpserver', netbirdIp: '100.100.192.119', source: 'soundsuite-import' });
    expect(mcp.apps[0]).toMatchObject({ masterUrlOverride: 'http://100.100.170.238:3000', wsPortOverride: 3002 });
    expect(await prisma.appMode.findFirst({ where: { appId: 'fantom', name: 'fantom-code-embedding' } })).not.toBeNull();
  });
  it('merges duplicate host rows left by an older import', async () => {
    await prisma.roleAssignment.deleteMany(); await prisma.hostApp.deleteMany(); await prisma.hostAlias.deleteMany(); await prisma.host.deleteMany();
    // Old import: one row per URL, no hostname column, no aliases.
    const a = await prisma.host.create({ data: { name: 'GPUWS34', agentUrl: 'http://192.168.20.6:8098', source: 'soundsuite-import' } });
    const b = await prisma.host.create({ data: { name: 'gpuws34-2', agentUrl: 'http://192.168.88.242:8098', source: 'soundsuite-import' } });
    await prisma.roleAssignment.create({ data: { hostId: b.id, appId: 'soundsuite', mode: 'ss-reranker', enabled: false } });
    const r = await importSoundSuite({ systemDb: ss }, false);
    expect(r.hosts.merged).toBe(1);
    expect(await prisma.host.count()).toBe(2);
    const kept = await prisma.host.findUniqueOrThrow({ where: { id: a.id }, include: { aliases: true, roles: true } });
    expect(kept).toMatchObject({ name: 'GPUWS34', hostname: 'gpuws34', agentUrl: 'http://192.168.20.6:8098' });
    expect(kept.aliases.map((x) => x.url).sort()).toEqual(['http://192.168.20.6:8098', 'http://192.168.88.242:8098']);
    expect(kept.roles.map((x) => x.mode).sort()).toEqual(['ss-ocr', 'ss-reranker']);
    expect(await prisma.host.findUnique({ where: { id: b.id } })).toBeNull();
    const again = await importSoundSuite({ systemDb: ss }, false);
    expect(again).toMatchObject({ hosts: { created: 0, merged: 0 }, aliases: { created: 0 } });
  });
  it('skips ignored URLs and keeps merged alias URLs with their host', async () => {
    await prisma.roleAssignment.deleteMany(); await prisma.hostApp.deleteMany(); await prisma.hostAlias.deleteMany(); await prisma.host.deleteMany();
    await importSoundSuite({ systemDb: ss }, false);
    // Admin removes mcpserver and ignores its URL.
    await prisma.host.deleteMany({ where: { agentUrl: 'http://100.100.192.119:8098' } });
    await setSetting(IGNORE_URLS_KEY, JSON.stringify(['http://100.100.192.119:8098/']));
    const r = await importSoundSuite({ systemDb: ss }, false);
    expect(r.hosts.created).toBe(0);
    expect(await prisma.host.findUnique({ where: { agentUrl: 'http://100.100.192.119:8098' } })).toBeNull();
    expect(await prisma.host.count()).toBe(1);
    await setSetting(IGNORE_URLS_KEY, '[]');
  });
});
