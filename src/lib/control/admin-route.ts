/** Admin API helper: login check, JSON errors, audit row. */
import { NextResponse } from 'next/server';
import { requireApiUser } from '../session';
import type { SessionUser } from '../auth';
import { guard } from './errors';

export async function asAdmin(fn: (u: SessionUser) => Promise<Response>): Promise<Response> {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  return guard(() => fn(u));
}
