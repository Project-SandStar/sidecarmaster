import { handleSidecarHttp } from '@/lib/relay/http';

/** Sidecar HTTP fallback (v1 path, same as Sound Suite). Sidecar bearer token, not an admin session. */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handleSidecarHttp('result', req);
}
