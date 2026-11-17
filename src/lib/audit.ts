import { prisma } from './db';
import { redact } from './crypto';

/** One row per write. Secret fields in `detail` are cut to their last 4 characters. */
export async function audit(actor: string, action: string, target?: string | null, detail?: unknown): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actor,
      action,
      target: target ?? null,
      detail: detail === undefined ? null : JSON.stringify(redact(detail)),
    },
  });
}
