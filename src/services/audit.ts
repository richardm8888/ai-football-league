import { prisma } from '@/lib/db';

/**
 * Audit trail.
 *
 * Every state change that a manager could dispute — plans submitted, approved,
 * locked, matchdays simulated or reopened, AI proposals accepted — is recorded
 * here with who did it and what changed.
 */
export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string;
  leagueId?: string;
  clubId?: string;
  userId?: string;
  before?: unknown;
  after?: unknown;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      leagueId: entry.leagueId,
      clubId: entry.clubId,
      userId: entry.userId,
      before: entry.before === undefined ? undefined : JSON.parse(JSON.stringify(entry.before)),
      after: entry.after === undefined ? undefined : JSON.parse(JSON.stringify(entry.after)),
    },
  });
}
