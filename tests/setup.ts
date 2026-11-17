import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

// Each test file gets a fresh SQLite DB with the real migrations applied.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-test-'));
const file = path.join(dir, 'test.db');
const db = new Database(file);
const migDir = path.resolve(import.meta.dirname, '../prisma/migrations');
for (const m of fs.readdirSync(migDir).filter((d) => fs.statSync(path.join(migDir, d)).isDirectory()).sort()) {
  db.exec(fs.readFileSync(path.join(migDir, m, 'migration.sql'), 'utf8'));
}
db.close();
process.env.DATABASE_URL = `file:${file}`;
process.env.SM_SECRET_KEY = 'test-secret-key-0123456789abcdef';
process.env.NETBIRD_CTL_DIR = path.join(dir, 'netbird-ctl');
fs.mkdirSync(process.env.NETBIRD_CTL_DIR);
