import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { autoSelectLineup, defaultTacticalPlan } from '@/domain/tactics/selection';
import { loadSquad, toSelectableView } from '@/services/club';
import { getCurrentMatchday, getLockStatus } from '@/services/matchday';
import { lockMatchPlan, saveMatchPlan } from '@/services/plans';
import { settleMatchdayIfReady } from '@/services/simulation';
import { createTestLeague, type TestLeague } from '../helpers/league';

/**
 * The league moves at the pace of its slowest human, and no slower.
 *
 * Nobody should have to be awake and pressing a button for a match to happen.
 * A matchday plays the moment the last human manager locks in, so a league of
 * friends who are all online can get through several matchdays in an evening,
 * while one manager going quiet holds things up only until the deadline.
 *
 * Clubs nobody manages are the other half of that promise: they must never be
 * something the league waits for, or every week would stall one lock short.
 */

const prisma = new PrismaClient();
let league: TestLeague;
/** Four managers, so the season generates six clubs and two go unclaimed. */
let humanClubs: TestLeague['clubs'];
let aiClubs: TestLeague['clubs'];

beforeAll(async () => {
  league = await createTestLeague(prisma, { managers: 4, seed: 'auto-advance' });
  humanClubs = league.clubs.filter((c) => c.ownerUserId);
  aiClubs = league.clubs.filter((c) => !c.ownerUserId);
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

/** Give a club a plan it would be happy to play, without locking it. */
async function prepare(club: { id: string; ownerUserId: string | null }, fixtureId: string) {
  const squad = await loadSquad(club.id);
  await saveMatchPlan({
    fixtureId,
    clubId: club.id,
    userId: club.ownerUserId!,
    phase: 'OPEN',
    plan: {
      tactics: defaultTacticalPlan('F_4_3_3'),
      lineup: autoSelectLineup(toSelectableView(squad), 'F_4_3_3'),
      notes: '',
    },
    approve: true,
  });
}

describe('a matchday plays itself once the humans are done', () => {
  it('generates a league with clubs nobody manages', () => {
    expect(humanClubs).toHaveLength(4);
    expect(aiClubs.length).toBeGreaterThan(0);
  });

  it('waits only on the clubs a person is actually managing', async () => {
    const matchday = await getCurrentMatchday(league.seasonId);
    const status = await getLockStatus(matchday!.id);
    // Six clubs are playing, but only the four with an owner can be chased.
    expect(status.total).toBe(humanClubs.length);
    expect(status.outstanding.map((c) => c.clubId).sort())
      .toEqual(humanClubs.map((c) => c.id).sort());
    for (const ai of aiClubs) {
      expect(status.outstanding.map((c) => c.clubId)).not.toContain(ai.id);
    }
  });

  it('does nothing while a human manager has still to lock in', async () => {
    const matchday = await getCurrentMatchday(league.seasonId);
    const matchdayId = matchday!.id;

    // Everyone but the last manager locks in.
    for (const club of humanClubs.slice(0, -1)) {
      const fixture = matchday!.fixtures.find(
        (f) => f.homeClubId === club.id || f.awayClubId === club.id)!;
      await prepare(club, fixture.id);
      await lockMatchPlan(fixture.id, club.id, club.ownerUserId!, 'OPEN');

      expect(await settleMatchdayIfReady(matchdayId, club.ownerUserId!)).toBeNull();
    }

    const status = await getLockStatus(matchdayId);
    expect(status.allLocked).toBe(false);
    expect(status.outstanding).toHaveLength(1);

    const still = await prisma.matchday.findUniqueOrThrow({ where: { id: matchdayId } });
    expect(still.phase).toBe('OPEN');
    expect(still.simulatedAt).toBeNull();
  }, 120_000);

  it('plays the match the moment the last human locks in', async () => {
    const matchday = await getCurrentMatchday(league.seasonId);
    const matchdayId = matchday!.id;
    const last = humanClubs[humanClubs.length - 1];
    const fixture = matchday!.fixtures.find(
      (f) => f.homeClubId === last.id || f.awayClubId === last.id)!;

    await prepare(last, fixture.id);
    await lockMatchPlan(fixture.id, last.id, last.ownerUserId!, 'OPEN');

    const summary = await settleMatchdayIfReady(matchdayId, last.ownerUserId!);
    expect(summary).not.toBeNull();
    expect(summary!.matches).toHaveLength(league.clubs.length / 2);

    // The matchday is finished and the next one is already open, so a league
    // that is all online can go straight into the following week.
    const played = await prisma.matchday.findUniqueOrThrow({ where: { id: matchdayId } });
    expect(played.phase).toBe('COMPLETE');
    expect(played.simulatedAt).not.toBeNull();

    const next = await getCurrentMatchday(league.seasonId);
    expect(next!.number).toBe(matchday!.number + 1);
    expect(next!.phase).toBe('OPEN');
  }, 180_000);

  it('froze the unmanaged clubs rather than waiting for them', async () => {
    const plans = await prisma.matchPlan.findMany({
      where: { clubId: { in: aiClubs.map((c) => c.id) }, fixture: { matchday: { number: 1 } } },
    });
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) expect(plan.status).toBe('LOCKED');
  });

  it('does not play a matchday twice', async () => {
    const first = await prisma.matchday.findFirstOrThrow({
      where: { seasonId: league.seasonId, number: 1 },
    });
    expect(await settleMatchdayIfReady(first.id, league.ownerId)).toBeNull();
  });
});
