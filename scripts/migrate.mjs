// Apply prisma/migrations/*/migration.sql in order. Tracks applied names in _sm_migrations.
// Used in the Docker image so the Prisma CLI is not needed at run time.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const url = process.env.DATABASE_URL ?? 'file:./data/sidecarmaster.db';
const file = path.resolve(url.replace(/^file:/, ''));
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new Database(file);
db.pragma('journal_mode = WAL');
db.exec('create table if not exists _sm_migrations (name text primary key, appliedAt text not null)');
const done = new Set(db.prepare('select name from _sm_migrations').all().map((r) => r.name));
const dir = path.resolve(process.env.SM_MIGRATIONS_DIR ?? 'prisma/migrations');
const list = fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort();
for (const m of list) {
  if (done.has(m)) continue;
  const sql = fs.readFileSync(path.join(dir, m, 'migration.sql'), 'utf8');
  db.transaction(() => {
    db.exec(sql);
    db.prepare('insert into _sm_migrations values (?, ?)').run(m, new Date().toISOString());
  })();
  console.log(`[migrate] applied ${m}`);
}
db.close();
