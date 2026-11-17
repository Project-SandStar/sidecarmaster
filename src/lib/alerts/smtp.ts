/**
 * Settings > Alerts. SMTP settings live in the Setting table; the password is encrypted.
 * Views never return the password, only hasPassword + last 4 characters.
 */
import nodemailer from 'nodemailer';
import { deleteSetting, getSetting, setSetting } from '../settings';

export type TlsMode = 'none' | 'starttls' | 'tls';
export const TLS_MODES: TlsMode[] = ['none', 'starttls', 'tls'];

export interface SmtpConfig {
  host: string; port: number; tls: TlsMode; username: string; password: string;
  from: string; to: string[]; enabled: boolean;
}
export interface SmtpView extends Omit<SmtpConfig, 'password'> { hasPassword: boolean; passwordHint: string | null }

export class SmtpError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const KEY = 'alerts.smtp';
const PW_KEY = 'alerts.smtp.password';
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const HOST_RE = /^[A-Za-z0-9.-]{1,253}$/;

const DEFAULTS: Omit<SmtpConfig, 'password'> = {
  host: '', port: 587, tls: 'starttls', username: '', from: '', to: [], enabled: false,
};

export const validEmail = (e: unknown): e is string => typeof e === 'string' && EMAIL_RE.test(e.trim());

/** "Name <a@b.c>" or "a@b.c". */
function validFrom(v: string): boolean {
  const m = v.match(/^[^<>]*<([^<>]+)>$/);
  return validEmail(m ? m[1] : v);
}

export function parseRecipients(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;\s]+/) : [];
  return list.map((x) => String(x).trim()).filter(Boolean);
}

async function readBase(): Promise<Omit<SmtpConfig, 'password'>> {
  const raw = await getSetting(KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    const r = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SmtpConfig>) };
    if (!TLS_MODES.includes(r.tls)) r.tls = DEFAULTS.tls;
    return r;
  } catch { return { ...DEFAULTS }; }
}

export async function readSmtp(): Promise<SmtpConfig> {
  return { ...(await readBase()), password: (await getSetting(PW_KEY)) ?? '' };
}

export async function smtpView(): Promise<SmtpView> {
  const base = await readBase();
  const pw = (await getSetting(PW_KEY)) ?? '';
  return { ...base, hasPassword: !!pw, passwordHint: pw ? pw.slice(-4) : null };
}

export async function updateSmtp(body: unknown): Promise<SmtpView> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const cfg = await readBase();
  if (b.host !== undefined) {
    const h = String(b.host).trim();
    if (h && !HOST_RE.test(h)) throw new SmtpError('SMTP host must be a host name or IP address');
    cfg.host = h;
  }
  if (b.port !== undefined) {
    const p = Number(b.port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw new SmtpError('SMTP port must be 1-65535');
    cfg.port = p;
  }
  if (b.tls !== undefined) {
    if (!TLS_MODES.includes(b.tls as TlsMode)) throw new SmtpError('TLS mode must be none, starttls or tls');
    cfg.tls = b.tls as TlsMode;
  }
  if (b.username !== undefined) cfg.username = String(b.username).trim();
  if (b.from !== undefined) {
    const f = String(b.from).trim();
    if (f && !validFrom(f)) throw new SmtpError('From must be an email address, or "Name <address>"');
    cfg.from = f;
  }
  if (b.to !== undefined) {
    const to = parseRecipients(b.to);
    const bad = to.find((x) => !validEmail(x));
    if (bad) throw new SmtpError(`Not a valid email address: ${bad}`);
    cfg.to = to;
  }
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') throw new SmtpError('enabled must be true or false');
    cfg.enabled = b.enabled;
  }
  if (cfg.enabled && (!cfg.host || !cfg.from || cfg.to.length === 0)) {
    throw new SmtpError('Fill in host, from and at least one recipient before you turn alerts on');
  }
  if (b.password !== undefined) {
    const pw = String(b.password);
    if (pw) await setSetting(PW_KEY, pw, true); else await deleteSetting(PW_KEY);
  }
  await setSetting(KEY, JSON.stringify(cfg));
  return smtpView();
}

export type Transport = { sendMail(m: nodemailer.SendMailOptions): Promise<unknown> };

export function makeTransport(cfg: SmtpConfig): Transport {
  return nodemailer.createTransport({
    host: cfg.host, port: cfg.port,
    // tls = implicit TLS (465); starttls = upgrade required; none = plain (lab only).
    secure: cfg.tls === 'tls', requireTLS: cfg.tls === 'starttls', ignoreTLS: cfg.tls === 'none',
    auth: cfg.username ? { user: cfg.username, pass: cfg.password } : undefined,
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000,
  });
}

/** Send one email with the saved settings. Throws SmtpError with a short, secret-free message. */
export async function sendMail(
  subject: string, text: string,
  opts: { to?: string[]; transport?: (c: SmtpConfig) => Transport } = {},
): Promise<{ to: string[] }> {
  const cfg = await readSmtp();
  if (!cfg.host || !cfg.from) throw new SmtpError('Save the SMTP host and From address first');
  const to = opts.to?.length ? opts.to : cfg.to;
  if (to.length === 0) throw new SmtpError('No recipient. Add one under "Send alerts to"');
  try {
    await (opts.transport ?? makeTransport)(cfg).sendMail({ from: cfg.from, to: to.join(', '), subject, text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Never echo the password, even if a server puts it in an error.
    const safe = cfg.password ? msg.split(cfg.password).join('***') : msg;
    throw new SmtpError(`Send failed: ${safe}`.slice(0, 400), 502);
  }
  return { to };
}

export function testEmailBody(actor: string, now = new Date()): { subject: string; text: string } {
  return {
    subject: 'sidecarmaster: test email',
    text: `This is a test email from sidecarmaster.\n\nSent by ${actor} at ${now.toISOString()}.\nIf you can read this, alert emails work.\n`,
  };
}
