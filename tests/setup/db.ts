import { PrismaClient } from '@prisma/client';

/**
 * A clean database for a persistence test.
 *
 * Truncating rather than dropping keeps the schema in place, and CASCADE means
 * the order of the table list does not matter.
 */
const TABLES = [
  'AuditLog', 'Report', 'AiMemory', 'AiDecision', 'AiMessage', 'AiConversation',
  'PlayerMatchPerformance', 'MatchStatistic', 'MatchEvent', 'Match',
  'PlayerRoleAssignment', 'Lineup', 'TacticalPlan', 'MatchPlan', 'TrainingPlan',
  'PlayerFamiliarity', 'TacticalFamiliarity', 'ClubHistory', 'PlayerState',
  'PlayerAttribute', 'Player', 'AiManager', 'Fixture', 'Matchday', 'Season',
  'Club', 'LeagueMembership', 'League', 'Session', 'User',
];

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE;`);
}
