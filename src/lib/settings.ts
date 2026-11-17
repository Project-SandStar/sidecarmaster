import { prisma } from './db';
import { decryptSecret, encryptSecret } from './crypto';

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return null;
  return row.secret ? decryptSecret(row.value) : row.value;
}

export async function setSetting(key: string, value: string, secret = false): Promise<void> {
  const stored = secret ? encryptSecret(value) : value;
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: stored, secret },
    update: { value: stored, secret },
  });
}

export async function deleteSetting(key: string): Promise<void> {
  await prisma.setting.deleteMany({ where: { key } });
}

export async function getJsonSetting<T>(key: string, fallback: T): Promise<T> {
  const v = await getSetting(key);
  if (!v) return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}
