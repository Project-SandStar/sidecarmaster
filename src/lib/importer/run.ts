import fs from 'node:fs';
import { prisma } from '../db';
import { getJsonSetting } from '../settings';
import { hostKey } from '../fleet/host-identity';
import { applyPlan, buildPlan, dropIgnored, norm, type GroupHints, type ImportReport } from './plan';
import { parseSnapshot, readSnapshot, type SoundSuiteSnapshot } from './snapshot';

export interface ImportSource { systemDb?: string; configDb?: string; snapshotFile?: string }

/** Source from env: SM_SOUNDSUITE_SYSTEM_DB (+ optional SM_SOUNDSUITE_CONFIG_DB), or SM_SOUNDSUITE_SNAPSHOT. */
export function sourceFromEnv(env: NodeJS.ProcessEnv = process.env): ImportSource | null {
  if (env.SM_SOUNDSUITE_SYSTEM_DB) return { systemDb: env.SM_SOUNDSUITE_SYSTEM_DB, configDb: env.SM_SOUNDSUITE_CONFIG_DB || undefined };
  if (env.SM_SOUNDSUITE_SNAPSHOT) return { snapshotFile: env.SM_SOUNDSUITE_SNAPSHOT };
  return null;
}

export function loadSnapshot(src: ImportSource): SoundSuiteSnapshot {
  if (src.snapshotFile) return parseSnapshot(JSON.parse(fs.readFileSync(src.snapshotFile, 'utf8')));
  if (!src.systemDb) throw new Error('No Sound Suite source. Set SM_SOUNDSUITE_SYSTEM_DB or SM_SOUNDSUITE_SNAPSHOT.');
  return readSnapshot(src.systemDb, src.configDb ?? src.systemDb);
}

/** Setting key: JSON array of sidecar URLs the importer never creates (hosts removed by an admin). */
export const IGNORE_URLS_KEY = 'importer.ignoreUrls';

/** URL -> group key from HostAlias, so merged URLs stay with their host. */
export async function aliasHints(): Promise<GroupHints> {
  const rows = await prisma.hostAlias.findMany({ include: { host: { select: { id: true, hostname: true } } } });
  return new Map(rows.map((a) => [norm(a.url), hostKey(a.host.hostname) ?? `host:${a.host.id}`]));
}

export async function importSoundSuite(src: ImportSource, dryRun: boolean): Promise<ImportReport> {
  const ignore = await getJsonSetting<string[]>(IGNORE_URLS_KEY, []);
  const snap = dropIgnored(loadSnapshot(src), Array.isArray(ignore) ? ignore : []);
  return applyPlan(prisma, snap, buildPlan(snap, await aliasHints()), dryRun);
}
