import { PrismaClient } from '@prisma/client';
import { hashPassword } from '@/services/auth';
import { createLeague, startSeason } from '@/services/league';
import { resetDatabase } from '../setup/db';

/**
 * A complete, playable league in the test database.
 *
 * Built through the real services rather than raw inserts, so the tests
 * exercise the same code path a manager's first visit does.
 */

export interface TestLeague {
  prisma: PrismaClient;
  leagueId: string;
  seasonId: string;
  users: Array<{ id: string; email: string; displayName: string }>;
  clubs: Array<{ id: string; name: string; ownerUserId: string | null }>;
  ownerId: string;
}

export async function createTestLeague(
  prisma: PrismaClient,
  options: { managers?: number; seed?: string; reset?: boolean } = {},
): Promise<TestLeague> {
  if (options.reset !== false) await resetDatabase(prisma);

  const managerCount = options.managers ?? 8;
  const passwordHash = await hashPassword('test-password-1234');
  const users = [];
  for (let i = 0; i < managerCount; i += 1) {
    users.push(await prisma.user.create({
      data: {
        email: `manager${i}@test.local`,
        displayName: `Manager ${i}`,
        passwordHash,
        isSuperAdmin: i === 0,
      },
    }));
  }

  const league = await createLeague(users[0].id, 'Test League');
  for (const user of users.slice(1)) {
    await prisma.leagueMembership.create({
      data: { leagueId: league.id, userId: user.id, role: 'MANAGER' },
    });
  }

  const { season, clubs } = await startSeason({
    leagueId: league.id,
    userId: users[0].id,
    seed: options.seed ?? 'test-league',
  });

  return {
    prisma,
    leagueId: league.id,
    seasonId: season.id,
    users: users.map((u) => ({ id: u.id, email: u.email, displayName: u.displayName })),
    clubs: clubs.map((c) => ({ id: c.id, name: c.name, ownerUserId: c.ownerUserId })),
    ownerId: users[0].id,
  };
}

/** The club a given manager owns. */
export function clubOf(league: TestLeague, userId: string) {
  const club = league.clubs.find((c) => c.ownerUserId === userId);
  if (!club) throw new Error(`No club owned by ${userId}`);
  return club;
}
