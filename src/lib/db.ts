import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

/** Absolute SQLite path from DATABASE_URL (`file:...`). */
export function dbFilePath(url = process.env.DATABASE_URL ?? 'file:./data/sidecarmaster.db'): string {
  const p = url.replace(/^file:/, '');
  return path.isAbsolute(p) ? p : path.join(/*turbopackIgnore: true*/ process.cwd(), p);
}

const g = globalThis as unknown as { __smPrisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (!g.__smPrisma) {
    const file = dbFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    g.__smPrisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: file }) });
  }
  return g.__smPrisma;
}

/** Lazy client: the DB file opens on first use, not at import (keeps `next build` DB-free). */
export const prisma = new Proxy({} as PrismaClient, {
  get(_t, k) {
    const c = getPrisma();
    const v = Reflect.get(c, k);
    return typeof v === 'function' ? v.bind(c) : v;
  },
});
