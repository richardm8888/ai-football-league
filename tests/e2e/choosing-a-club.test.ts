import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '@/services/auth';
import { loadSquad } from '@/services/club';
import { claimClub, joinLeague, LeagueError, listClubChoices } from '@/services/league';
import { createTestLeague, type TestLeague } from '../helpers/league';

/**
 * Taking charge of a club.
 *
 * Which club you manage is the first real decision of the game, so it is made
 * on information rather than on join order. The information has to be the sort
 * every manager already has: what a club is known for and how it is doing.
 * A squad list here would hand whoever picks last a scouting report on the
 * whole league, which is the one thing the game is built not to allow.
 */

const prisma = new PrismaClient();
let league: TestLeague;

beforeAll(async () => {
  league = await createTestLeague(prisma, { managers: 4, seed: 'club-choice' });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

/** A manager who has just arrived with the invite code. */
async function newcomer(email: string) {
  const user = await prisma.user.create({
    data: {
      email,
      displayName: email,
      passwordHash: await hashPassword('test-password-1234'),
    },
  });
  const row = await prisma.league.findUniqueOrThrow({ where: { id: league.leagueId } });
  await joinLeague(user.id, row.inviteCode);
  return user;
}

describe('joining a league', () => {
  it('does not hand out a club', async () => {
    const user = await newcomer('chooser1@test.local');
    const club = await prisma.club.findFirst({
      where: { leagueId: league.leagueId, ownerUserId: user.id },
    });
    expect(club).toBeNull();
  });

  it('still makes you a member, so you can see the league', async () => {
    const membership = await prisma.leagueMembership.findFirst({
      where: { leagueId: league.leagueId, user: { email: 'chooser1@test.local' } },
    });
    expect(membership).not.toBeNull();
  });
});

describe('what a manager is shown before choosing', () => {
  it('lists every club, saying which are still free', async () => {
    const choices = await listClubChoices(league.leagueId);
    expect(choices).toHaveLength(league.clubs.length);
    expect(choices.some((c) => c.available)).toBe(true);
    expect(choices.some((c) => !c.available)).toBe(true);
  });

  it('describes a club by what it is known for and how it is doing', async () => {
    const choices = await listClubChoices(league.leagueId);
    for (const choice of choices) {
      expect(choice.name.length).toBeGreaterThan(0);
      expect(choice.identity.length).toBeGreaterThan(0);
      expect(choice.reputation).toBeGreaterThan(0);
    }
  });

  it('offers no league position before a ball has been kicked', async () => {
    const choices = await listClubChoices(league.leagueId);
    // Every club is on nought points, so a position would only be the sort
    // order dressed up as a fact.
    for (const choice of choices) {
      expect(choice.position).toBeNull();
      expect(choice.played).toBe(0);
    }
  });

  it('never exposes another club’s players', async () => {
    const choices = await listClubChoices(league.leagueId);
    const serialised = JSON.stringify(choices);
    // Ids are cuids, so a player id here could only have come from a squad.
    for (const club of league.clubs) {
      for (const player of await loadSquad(club.id)) {
        expect(serialised).not.toContain(player.id);
      }
    }
  }, 120_000);
});

describe('taking a club', () => {
  it('gives the club to the manager who asked for it', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { email: 'chooser1@test.local' } });
    const free = (await listClubChoices(league.leagueId)).find((c) => c.available)!;

    const claimed = await claimClub(league.leagueId, free.id, user.id);
    expect(claimed.id).toBe(free.id);

    const row = await prisma.club.findUniqueOrThrow({ where: { id: free.id } });
    expect(row.ownerUserId).toBe(user.id);
  });

  it('refuses a club that is already taken', async () => {
    const user = await newcomer('chooser2@test.local');
    const taken = (await listClubChoices(league.leagueId)).find((c) => !c.available)!;
    await expect(claimClub(league.leagueId, taken.id, user.id)).rejects.toBeInstanceOf(LeagueError);
  });

  it('refuses a second club to a manager who already has one', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { email: 'chooser1@test.local' } });
    const free = (await listClubChoices(league.leagueId)).find((c) => c.available);
    if (!free) return;
    await expect(claimClub(league.leagueId, free.id, user.id)).rejects.toBeInstanceOf(LeagueError);
  });

  it('refuses someone who is not in the league', async () => {
    const outsider = await prisma.user.create({
      data: {
        email: 'outsider@test.local',
        displayName: 'Outsider',
        passwordHash: await hashPassword('test-password-1234'),
      },
    });
    const free = (await listClubChoices(league.leagueId)).find((c) => c.available);
    if (!free) return;
    await expect(claimClub(league.leagueId, free.id, outsider.id))
      .rejects.toBeInstanceOf(LeagueError);
  });

  it('gives a contested club to exactly one of the managers racing for it', async () => {
    const free = (await listClubChoices(league.leagueId)).find((c) => c.available);
    if (!free) return;

    const [a, b] = await Promise.all([
      newcomer('racer-a@test.local'), newcomer('racer-b@test.local'),
    ]);
    const results = await Promise.allSettled([
      claimClub(league.leagueId, free.id, a.id),
      claimClub(league.leagueId, free.id, b.id),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const row = await prisma.club.findUniqueOrThrow({ where: { id: free.id } });
    expect([a.id, b.id]).toContain(row.ownerUserId);
  });
});
