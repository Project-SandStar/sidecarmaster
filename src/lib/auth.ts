import { hash, verify } from '@node-rs/argon2';
import { prisma } from './db';
import { randomToken, sha256Hex } from './crypto';

export const SESSION_COOKIE = 'sm_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// Argon2id (algorithm 2), OWASP-style parameters.
const ARGON = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(pw: string): Promise<string> {
  return hash(pw, ARGON);
}

export async function verifyPassword(stored: string, pw: string): Promise<boolean> {
  try { return await verify(stored, pw); } catch { return false; }
}

/** Create the first admin from SM_ADMIN_USERNAME / SM_ADMIN_PASSWORD when no admin exists. */
export async function ensureFirstAdmin(env: NodeJS.ProcessEnv = process.env): Promise<'created' | 'exists' | 'missing-env'> {
  if ((await prisma.adminUser.count()) > 0) return 'exists';
  const username = env.SM_ADMIN_USERNAME?.trim();
  const password = env.SM_ADMIN_PASSWORD;
  if (!username || !password) return 'missing-env';
  await prisma.adminUser.create({ data: { username, passwordHash: await hashPassword(password) } });
  return 'created';
}

export interface SessionUser { id: string; username: string }

/** Check username + password. On success returns a new session token (only its hash is stored). */
export async function login(username: string, password: string): Promise<{ token: string; user: SessionUser } | null> {
  await ensureFirstAdmin();
  const u = await prisma.adminUser.findUnique({ where: { username } });
  // Verify against a dummy hash when the user is unknown, so timing does not tell.
  if (!u || !u.enabled) { await verifyPassword(DUMMY_HASH, password); return null; }
  if (!(await verifyPassword(u.passwordHash, password))) return null;
  const token = randomToken();
  await prisma.session.create({ data: { tokenHash: sha256Hex(token), userId: u.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
  await prisma.adminUser.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } });
  return { token, user: { id: u.id, username: u.username } };
}

export async function userForToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: true } });
  if (!s || s.expiresAt.getTime() < Date.now() || !s.user.enabled) return null;
  return { id: s.user.id, username: s.user.username };
}

export async function logout(token: string | undefined | null): Promise<void> {
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
}

const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$HOOlRFeQVtfvqJBdc3nSjQ$UTZMevlW0s8LXGXfzdy7gc9FaaCmLL3Z085Oe+rC3/I';
