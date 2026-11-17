import { NextResponse } from 'next/server';
import { netbirdStore } from '@/lib/netbird';
import { requireApiUser } from '@/lib/session';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function DELETE() {
  const u = await requireApiUser();
  if (u instanceof NextResponse) return u;
  const v = netbirdStore().removeToken();
  await audit(u.username, 'settings.https.token.remove');
  return NextResponse.json(v);
}
