import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { markTourSeen } from '@/services/auth';
import { createTestLeague, type TestLeague } from '../helpers/league';

/**
 * Being shown around, once.
 *
 * The walkthrough is the only thing in the game that is allowed to interrupt a
 * manager, so the rule it lives by is worth a test: it runs for someone who has
 * never seen it, and it never runs again afterwards. A tour that reappears every
 * week would be worse than no tour at all.
 */

const prisma = new PrismaClient();
let league: TestLeague;

beforeAll(async () => {
  league = await createTestLeague(prisma, { seed: 'onboarding-tests', managers: 2 });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('the first-run walkthrough', () => {
  it('is owed to a manager who has never been shown it', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: league.ownerId } });
    expect(user.tourSeenAt).toBeNull();
  });

  it('is recorded once it has been shown', async () => {
    await markTourSeen(league.ownerId);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: league.ownerId } });
    expect(user.tourSeenAt).toBeInstanceOf(Date);
  });

  it('does not move the date if it is dismissed again', async () => {
    const first = await prisma.user.findUniqueOrThrow({ where: { id: league.ownerId } });
    await markTourSeen(league.ownerId);
    const second = await prisma.user.findUniqueOrThrow({ where: { id: league.ownerId } });
    expect(second.tourSeenAt).toEqual(first.tourSeenAt);
  });

  it('is per manager, not per league', async () => {
    const other = league.users.find((u) => u.id !== league.ownerId)!;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });
    expect(user.tourSeenAt).toBeNull();
  });
});
