import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { autoSelectLineup, defaultTacticalPlan } from '@/domain/tactics/selection';
import { loadSquad, toSelectableView } from '@/services/club';
import { resetSeason } from '@/services/league';
import { getCurrentMatchday } from '@/services/matchday';
import { lockMatchPlan, saveMatchPlan } from '@/services/plans';
import { settleMatchdayIfReady } from '@/services/simulation';
import { createTestLeague, type TestLeague } from '../helpers/league';

/**
 * Putting a league back to day one.
 *
 * An interim testing tool rather than a game mechanic: a group has to walk the
 * opening week several times to get it right, and starting a fresh league every
 * time means never comparing like with like. So the clubs, squads and fixture
 * list survive and everything the league went on to do is removed.
 */

const prisma = new PrismaClient();
let league: TestLeague;

beforeAll(async () => {
  league = await createTestLeague(prisma, { managers: 4, seed: 'reset-tests' });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

/** Play matchday one through, so there is something to throw away. */
async function playAMatchday() {
  const matchday = await getCurrentMatchday(league.seasonId);
  for (const club of league.clubs.filter((c) => c.ownerUserId)) {
    const fixture = matchday!.fixtures.find(
      (f) => f.homeClubId === club.id || f.awayClubId === club.id)!;
    const squad = await loadSquad(club.id);
    await saveMatchPlan({
      fixtureId: fixture.id,
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
    await lockMatchPlan(fixture.id, club.id, club.ownerUserId!, 'OPEN');
  }
  return settleMatchdayIfReady(matchday!.id, league.ownerId);
}

describe('resetting a league to day one', () => {
  it('starts from a league that has actually played', async () => {
    const summary = await playAMatchday();
    expect(summary).not.toBeNull();
    expect(await prisma.match.count()).toBeGreaterThan(0);
    expect(await prisma.report.count()).toBeGreaterThan(0);
  }, 180_000);

  it('keeps the clubs, squads and fixtures', async () => {
    const before = {
      clubs: await prisma.club.count({ where: { leagueId: league.leagueId } }),
      players: await prisma.player.count(),
      fixtures: await prisma.fixture.count({ where: { seasonId: league.seasonId } }),
      matchdays: await prisma.matchday.count({ where: { seasonId: league.seasonId } }),
    };

    await resetSeason(league.leagueId, league.ownerId);

    expect(await prisma.club.count({ where: { leagueId: league.leagueId } })).toBe(before.clubs);
    expect(await prisma.player.count()).toBe(before.players);
    expect(await prisma.fixture.count({ where: { seasonId: league.seasonId } })).toBe(before.fixtures);
    expect(await prisma.matchday.count({ where: { seasonId: league.seasonId } })).toBe(before.matchdays);
  }, 120_000);

  it('throws away everything the league did', async () => {
    expect(await prisma.match.count()).toBe(0);
    expect(await prisma.matchPlan.count()).toBe(0);
    expect(await prisma.trainingPlan.count()).toBe(0);
    expect(await prisma.report.count({ where: { seasonId: league.seasonId } })).toBe(0);
    expect(await prisma.clubHistory.count({ where: { seasonId: league.seasonId } })).toBe(0);
    expect(await prisma.aiDecision.count()).toBe(0);
    expect(await prisma.aiConversation.count()).toBe(0);
  });

  it('puts the calendar back to an unplayed matchday one', async () => {
    const current = await getCurrentMatchday(league.seasonId);
    expect(current?.number).toBe(1);
    expect(current?.phase).toBe('OPEN');

    const simulated = await prisma.matchday.count({
      where: { seasonId: league.seasonId, simulatedAt: { not: null } },
    });
    expect(simulated).toBe(0);

    const played = await prisma.fixture.count({
      where: { seasonId: league.seasonId, status: { not: 'SCHEDULED' } },
    });
    expect(played).toBe(0);

    const season = await prisma.season.findUniqueOrThrow({ where: { id: league.seasonId } });
    expect(season.status).toBe('ACTIVE');
  });

  it('puts every club back on the shelf so the joining flow can be walked again', async () => {
    const owned = await prisma.club.count({
      where: { leagueId: league.leagueId, ownerUserId: { not: null } },
    });
    expect(owned).toBe(0);
  });

  it('gives the squads a fresh, varied starting condition', async () => {
    const states = await prisma.playerState.findMany({
      select: { fitness: true, form: true, appearances: true, goals: true, injury: true },
    });
    expect(states.length).toBeGreaterThan(0);
    for (const state of states) {
      expect(state.appearances).toBe(0);
      expect(state.goals).toBe(0);
      expect(state.injury).toBe('NONE');
      expect(state.fitness).toBeGreaterThanOrEqual(88);
    }
    // Week one is deliberately not uniformly perfect, so the reset must not
    // flatten every squad to the same numbers.
    expect(new Set(states.map((s) => s.form)).size).toBeGreaterThan(1);
  });

  it('leaves the league playable, not just tidy', async () => {
    // Give the clubs back to their managers and play the opening week again.
    for (const club of league.clubs) {
      if (club.ownerUserId) {
        await prisma.club.update({ where: { id: club.id }, data: { ownerUserId: club.ownerUserId } });
      }
    }
    const summary = await playAMatchday();
    expect(summary).not.toBeNull();
    expect(summary!.matches).toHaveLength(league.clubs.length / 2);
  }, 180_000);
});
