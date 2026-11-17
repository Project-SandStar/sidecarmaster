import { describe, expect, it } from 'vitest';
import { readSmtp, sendMail, smtpView, updateSmtp, type Transport } from '@/lib/alerts/smtp';
import { prisma } from '@/lib/db';

describe('SMTP alerts settings', () => {
  it('saves settings and never returns the password', async () => {
    const v = await updateSmtp({ host: 'smtp.example.com', port: 587, tls: 'starttls', username: 'u', password: 'pw-secret-7777', from: 'sm <a@example.com>', to: 'x@example.com, y@example.com' });
    expect(JSON.stringify(v)).not.toContain('pw-secret');
    expect(v).toMatchObject({ hasPassword: true, passwordHint: '7777', to: ['x@example.com', 'y@example.com'] });
    const row = await prisma.setting.findUniqueOrThrow({ where: { key: 'alerts.smtp.password' } });
    expect(row.secret).toBe(true);
    expect(row.value).not.toContain('pw-secret');
    expect((await readSmtp()).password).toBe('pw-secret-7777');
    // Empty password field keeps the saved one.
    await updateSmtp({ port: 465, tls: 'tls' });
    expect((await smtpView()).hasPassword).toBe(true);
  });
  it('validates input', async () => {
    await expect(updateSmtp({ to: 'not-an-email' })).rejects.toThrow(/valid email/);
    await expect(updateSmtp({ tls: 'ssl3' })).rejects.toThrow(/TLS mode/);
    await expect(updateSmtp({ port: 0 })).rejects.toThrow(/port/);
  });
  it('sends a test email through the transport', async () => {
    const sent: unknown[] = [];
    const t: Transport = { sendMail: async (m) => { sent.push(m); return {}; } };
    const r = await sendMail('s', 'body', { transport: () => t });
    expect(r.to).toEqual(['x@example.com', 'y@example.com']);
    expect(sent).toHaveLength(1);
  });
  it('hides the password if the server echoes it', async () => {
    const t: Transport = { sendMail: async () => { throw new Error('535 auth failed for pw-secret-7777'); } };
    await expect(sendMail('s', 'b', { transport: () => t })).rejects.toThrow(/auth failed for \*\*\*/);
  });
});
