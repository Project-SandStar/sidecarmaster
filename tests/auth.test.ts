import { beforeAll, describe, expect, it } from 'vitest';
import { ensureFirstAdmin, login, logout, userForToken } from '@/lib/auth';
import { prisma } from '@/lib/db';

describe('admin login', () => {
  beforeAll(async () => {
    expect(await ensureFirstAdmin({ } as unknown as NodeJS.ProcessEnv)).toBe('missing-env');
    expect(await ensureFirstAdmin({ SM_ADMIN_USERNAME: 'admin', SM_ADMIN_PASSWORD: 'correct horse' } as unknown as NodeJS.ProcessEnv)).toBe('created');
  });
  it('creates the first admin only once, with a hashed password', async () => {
    expect(await ensureFirstAdmin({ SM_ADMIN_USERNAME: 'other', SM_ADMIN_PASSWORD: 'x' } as unknown as NodeJS.ProcessEnv)).toBe('exists');
    const u = await prisma.adminUser.findUniqueOrThrow({ where: { username: 'admin' } });
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    expect(u.passwordHash).not.toContain('correct horse');
  });
  it('accepts the right password and refuses a wrong one or unknown user', async () => {
    expect(await login('admin', 'wrong')).toBeNull();
    expect(await login('nobody', 'correct horse')).toBeNull();
    const r = await login('admin', 'correct horse');
    expect(r?.user.username).toBe('admin');
    expect(await userForToken(r!.token)).toEqual(r!.user);
    const s = await prisma.session.findFirstOrThrow();
    expect(s.tokenHash).not.toBe(r!.token);
    await logout(r!.token);
    expect(await userForToken(r!.token)).toBeNull();
  });
  it('refuses an expired session', async () => {
    const r = (await login('admin', 'correct horse'))!;
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await userForToken(r.token)).toBeNull();
  });
});
