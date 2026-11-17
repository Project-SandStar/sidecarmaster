import { NextResponse } from 'next/server';

/** A refusal with an HTTP status (400 bad input, 404 missing, 409 clash). */
export class ControlError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Run a handler body; turn ControlError into JSON with its status. */
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try { return await fn(); } catch (e) {
    if (e instanceof ControlError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* fall through */ }
  throw new ControlError('Body must be a JSON object');
}

export const str = (v: unknown, name: string, opt = false): string | null => {
  if (v === undefined || v === null || v === '') { if (opt) return null; throw new ControlError(`${name} is required`); }
  if (typeof v !== 'string') throw new ControlError(`${name} must be text`);
  return v.trim();
};
export const int = (v: unknown, name: string, min: number, max: number, opt = false): number | null => {
  if (v === undefined || v === null || v === '') { if (opt) return null; throw new ControlError(`${name} is required`); }
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw new ControlError(`${name} must be a whole number ${min}–${max}`);
  return n;
};
