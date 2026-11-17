/**
 * sidecarmaster import-soundsuite --system-db <path> [--config-db <path>] [--snapshot <json>] [--dry-run]
 * Reads Sound Suite read-only and upserts hosts, role types, roles and host provisioning.
 */
import 'dotenv/config';
import { importSoundSuite, sourceFromEnv, type ImportSource } from '../src/lib/importer/run';

const args = process.argv.slice(2);
const val = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const src: ImportSource = args.length && (val('--system-db') || val('--snapshot'))
  ? { systemDb: val('--system-db'), configDb: val('--config-db'), snapshotFile: val('--snapshot') }
  : sourceFromEnv() ?? {};
const dryRun = args.includes('--dry-run');

importSoundSuite(src, dryRun)
  .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
  .catch((e) => { console.error(`import failed: ${e instanceof Error ? e.message : e}`); process.exit(1); });
