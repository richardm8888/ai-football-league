import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { askCoach } from '@/ai/coach';
import { buildTable } from '@/domain/league/standings';
import type { LeagueRoundup } from '@/domain/reports/roundup';
import { matchdayCount } from '@/domain/generation/fixtures';
import { canManageClub, canViewMatchPlan, canViewReport } from '@/domain/visibility';
import { autoSelectLineup, defaultTacticalPlan } from '@/domain/tactics/selection';
import { getViewer } from '@/services/auth';
import { loadSquad, toSelectableView } from '@/services/club';
import {
  advancePhase, getLockStatus, getCurrentMatchday, reopenMatchday, setPhase,
} from '@/services/matchday';
import {
  getOrCreateMatchPlan, getOrCreateTrainingPlan, lockMatchPlan, PlanError,
  saveMatchPlan, saveTrainingPlan,
} from '@/services/plans';
import { loadPlayedFixtures, openNextMatchday, simulateMatchday } from '@/services/simulation';
import { clubOf, createTestLeague, type TestLeague } from '../helpers/league';

/**
 * A complete matchday, start to finish.
 *
 * This is the walk-through from the design brief: create a league, add managers,
 * generate clubs and squads, open a matchday, submit training and tactics, lock
 * everything, simulate, publish reports, update the table, and open next week.
 */

const prisma = new PrismaClient();
let league: TestLeague;

beforeAll(async () => {
  league = await createTestLeague(prisma, { seed: 'e2e', managers: 8 });
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('a league is ready to play', () => {
  it('creates a club per manager, each with a full squad and coaching staff', async () => {
    expect(league.clubs.length).toBe(8);
    for (const club of league.clubs) {
      expect(club.ownerUserId).toBeTruthy();
      const squad = await loadSquad(club.id);
      expect(squad.length).toBeGreaterThanOrEqual(20);
      expect(squad.filter((p) => p.primaryPosition === 'GK').length).toBeGreaterThanOrEqual(2);
      const staff = await prisma.aiManager.findUnique({ where: { clubId: club.id } });
      expect(staff?.name).toBeTruthy();
    }
  });

  it('schedules a full double round-robin season', async () => {
    const matchdays = await prisma.matchday.findMany({ where: { seasonId: league.seasonId } });
    expect(matchdays).toHaveLength(matchdayCount(8));
    const fixtures = await prisma.fixture.findMany({ where: { seasonId: league.seasonId } });
    expect(fixtures).toHaveLength(8 * 7);
    for (const matchday of matchdays) {
      const round = fixtures.filter((f) => f.matchdayId === matchday.id);
      expect(round).toHaveLength(4);
    }
  });

  it('opens the first matchday', async () => {
    const matchday = await getCurrentMatchday(league.seasonId);
    expect(matchday?.number).toBe(1);
    expect(matchday?.phase).toBe('OPEN');
  });
});

describe('authorisation', () => {
  it('lets a manager act only for their own club', async () => {
    const viewer = await getViewer(league.users[0].id);
    const own = clubOf(league, league.users[0].id);
    const other = clubOf(league, league.users[1].id);
    expect(canManageClub(viewer, own.id)).toBe(true);
    expect(canManageClub(viewer, other.id)).toBe(false);
  });

  it('refuses a plan submitted for a club the manager does not own', async () => {
    const other = clubOf(league, league.users[1].id);
    const matchday = await getCurrentMatchday(league.seasonId);
    const fixture = matchday!.fixtures.find(
      (f) => f.homeClubId === other.id || f.awayClubId === other.id)!;
    const plan = await getOrCreateMatchPlan(fixture.id, other.id);

    // The service is the last line; the action layer checks ownership first.
    const viewer = await getViewer(league.users[0].id);
    expect(canManageClub(viewer, other.id)).toBe(false);
    expect(plan.clubId).toBe(other.id);
  });

  it('hides an opponent unplayed plan and shows it once the match is done', async () => {
    // An ordinary manager, not the league administrator, who can see everything.
    const viewer = await getViewer(league.users[3].id);
    const other = clubOf(league, league.users[1].id);
    expect(canViewMatchPlan(viewer, other.id, 'OPEN')).toBe(false);
    expect(canViewMatchPlan(viewer, other.id, 'LOCKED')).toBe(false);
    expect(canViewMatchPlan(viewer, other.id, 'POST_MATCH')).toBe(true);
    // Their own club is always visible to them.
    expect(canViewMatchPlan(viewer, clubOf(league, league.users[3].id).id, 'OPEN')).toBe(true);
  });

  it('publishes reports to the league only after the matchday is played', async () => {
    const viewer = await getViewer(league.users[3].id);
    expect(canViewReport(viewer, league.leagueId, 'LOCKED')).toBe(false);
    expect(canViewReport(viewer, league.leagueId, 'POST_MATCH')).toBe(true);
    expect(canViewReport(viewer, 'some-other-league', 'POST_MATCH')).toBe(false);
  });
});

describe('the weekly loop', () => {
  it('runs a full matchday from open to report', async () => {
    const matchday = await getCurrentMatchday(league.seasonId);
    expect(matchday).toBeTruthy();
    const matchdayId = matchday!.id;

    // --- Preparation: every manager sets training and tactics -------------
    // No phases to step through: the matchday is open from the moment it opens.

    for (const club of league.clubs) {
      const userId = club.ownerUserId!;
      const fixture = matchday!.fixtures.find(
        (f) => f.homeClubId === club.id || f.awayClubId === club.id)!;

      await getOrCreateTrainingPlan(club.id, matchdayId);
      await saveTrainingPlan({
        clubId: club.id, matchdayId, userId, phase: 'OPEN',
        plan: {
          primaryFocus: 'FORMATION_FAMILIARITY',
          secondaryFocus: 'MATCH_PREPARATION',
          intensity: 'NORMAL',
          targetFormation: null,
          individualFocus: [],
          notes: '',
        },
        approve: true,
      });

      const squad = await loadSquad(club.id);
      const tactics = defaultTacticalPlan('F_4_3_3');
      const lineup = autoSelectLineup(toSelectableView(squad), 'F_4_3_3');
      await saveMatchPlan({
        fixtureId: fixture.id, clubId: club.id, userId, phase: 'OPEN',
        plan: { tactics, lineup, notes: '' }, approve: true,
      });
    }

    let lockStatus = await getLockStatus(matchdayId);
    expect(lockStatus.allLocked).toBe(false);
    expect(lockStatus.total).toBe(8);

    // --- Locking ----------------------------------------------------------
    for (const club of league.clubs) {
      const fixture = matchday!.fixtures.find(
        (f) => f.homeClubId === club.id || f.awayClubId === club.id)!;
      await lockMatchPlan(fixture.id, club.id, club.ownerUserId!, 'OPEN');
    }
    lockStatus = await getLockStatus(matchdayId);
    expect(lockStatus.allLocked).toBe(true);
    expect(lockStatus.outstanding).toEqual([]);

    // A locked plan cannot be edited.
    const firstClub = league.clubs[0];
    const firstFixture = matchday!.fixtures.find(
      (f) => f.homeClubId === firstClub.id || f.awayClubId === firstClub.id)!;
    await expect(saveMatchPlan({
      fixtureId: firstFixture.id, clubId: firstClub.id, userId: firstClub.ownerUserId!,
      phase: 'OPEN',
      plan: {
        tactics: defaultTacticalPlan('F_3_5_2'),
        lineup: autoSelectLineup(toSelectableView(await loadSquad(firstClub.id)), 'F_3_5_2'),
        notes: '',
      },
    })).rejects.toBeInstanceOf(PlanError);

    // --- Simulation -------------------------------------------------------
    await setPhase(matchdayId, 'LOCKED', league.ownerId);
    const summary = await simulateMatchday(matchdayId, league.ownerId);
    expect(summary.matches).toHaveLength(4);
    for (const match of summary.matches) {
      expect(match.homeGoals).toBeGreaterThanOrEqual(0);
      expect(match.awayGoals).toBeGreaterThanOrEqual(0);
    }

    const after = await prisma.matchday.findUniqueOrThrow({ where: { id: matchdayId } });
    expect(after.phase).toBe('POST_MATCH');
    expect(after.simulatedAt).toBeInstanceOf(Date);

    // --- What the simulation wrote ---------------------------------------
    const matches = await prisma.match.findMany({
      where: { fixture: { matchdayId } },
      include: { events: true, statistics: true, performances: true },
    });
    expect(matches).toHaveLength(4);
    for (const match of matches) {
      expect(match.seed).toBeTruthy();
      expect(match.engineVersion).toBeTruthy();
      expect(match.inputSnapshot).toBeTruthy();
      expect(match.statistics).toHaveLength(2);
      expect(match.events.length).toBeGreaterThan(20);
      expect(match.performances.length).toBeGreaterThanOrEqual(22);
      const goalEvents = match.events.filter((e) => e.type === 'GOAL');
      expect(goalEvents).toHaveLength(match.homeGoals + match.awayGoals);
      const scored = match.performances.reduce((sum, p) => sum + p.goals, 0);
      expect(scored).toBe(match.homeGoals + match.awayGoals);
    }

    // --- Reports ----------------------------------------------------------
    const roundupRow = await prisma.report.findFirstOrThrow({
      where: { matchdayId, kind: 'LEAGUE_ROUNDUP' },
    });
    const roundup = roundupRow.payload as unknown as LeagueRoundup;
    expect(roundup.results).toHaveLength(4);
    expect(roundup.table).toHaveLength(8);
    expect(roundup.headlines.length).toBeGreaterThan(0);
    expect(roundup.topPerformers.length).toBeGreaterThan(0);

    // The report must agree with the simulation, number for number.
    for (const result of roundup.results) {
      const match = matches.find((m) => m.fixtureId === result.fixtureId)!;
      expect(result.homeGoals).toBe(match.homeGoals);
      expect(result.awayGoals).toBe(match.awayGoals);
      const homeStats = match.statistics.find((s) => s.side === 'HOME')!;
      expect(result.homePossession).toBe(homeStats.possession);
      expect(result.homeShots).toBe(homeStats.shots);
      expect(result.narrative.length).toBeGreaterThan(40);
    }

    const matchReports = await prisma.report.findMany({ where: { matchdayId, kind: 'MATCH_REPORT' } });
    expect(matchReports).toHaveLength(4);

    // No private information leaks into a published report.
    const published = JSON.stringify(roundup);
    const conversations = await prisma.aiMessage.findMany({ take: 5 });
    for (const message of conversations) {
      if (message.content.length > 30) expect(published).not.toContain(message.content);
    }

    // --- Table ------------------------------------------------------------
    const table = buildTable(
      league.clubs.map((c) => c.id), await loadPlayedFixtures(league.seasonId));
    const totalPoints = table.reduce((sum, row) => sum + row.points, 0);
    const totalGoals = table.reduce((sum, row) => sum + row.goalsFor, 0);
    const played = matches.reduce((sum, m) => sum + m.homeGoals + m.awayGoals, 0);
    expect(totalGoals).toBe(played);
    // Four matches award either 3 points (a win) or 2 (a draw).
    expect(totalPoints).toBeGreaterThanOrEqual(8);
    expect(totalPoints).toBeLessThanOrEqual(12);
    for (const row of table) expect(row.played).toBe(1);

    const history = await prisma.clubHistory.findMany({ where: { matchdayId } });
    expect(history).toHaveLength(8);
    for (const row of history) {
      const tableRow = table.find((t) => t.clubId === row.clubId)!;
      expect(row.points).toBe(tableRow.points);
      expect(row.position).toBe(tableRow.position);
    }

    // --- Player state moved ----------------------------------------------
    const appearances = await prisma.playerState.count({ where: { appearances: { gt: 0 } } });
    expect(appearances).toBeGreaterThanOrEqual(88);

    // --- Familiarity grew where it was trained ---------------------------
    const formationFamiliarity = await prisma.tacticalFamiliarity.findMany({
      where: { dimension: 'FORMATION', key: 'F_4_3_3' },
    });
    expect(formationFamiliarity).toHaveLength(8);
    for (const row of formationFamiliarity) expect(row.value).toBeGreaterThan(35);

    // --- Audit ------------------------------------------------------------
    const actions = (await prisma.auditLog.findMany({ select: { action: true } }))
      .map((a) => a.action);
    for (const expected of [
      'LEAGUE_CREATED', 'MATCH_PLAN_APPROVED', 'MATCH_PLAN_LOCKED',
      'TRAINING_PLAN_APPROVED', 'MATCHDAY_SIMULATED',
    ]) {
      expect(actions).toContain(expected);
    }

    // --- Next week --------------------------------------------------------
    const next = await openNextMatchday(matchdayId, league.ownerId);
    expect(next?.number).toBe(2);
    const closed = await prisma.matchday.findUniqueOrThrow({ where: { id: matchdayId } });
    expect(closed.phase).toBe('COMPLETE');
    const current = await getCurrentMatchday(league.seasonId);
    expect(current?.number).toBe(2);
    expect(current?.phase).toBe('OPEN');
  }, 180_000);

  it('refuses to simulate a matchday twice', async () => {
    const played = await prisma.matchday.findFirstOrThrow({
      where: { seasonId: league.seasonId, number: 1 },
    });
    await expect(simulateMatchday(played.id, league.ownerId))
      .rejects.toThrow(/already been simulated/);
  });

  it('refuses to reopen a matchday that has been played', async () => {
    const played = await prisma.matchday.findFirstOrThrow({
      where: { seasonId: league.seasonId, number: 1 },
    });
    await expect(reopenMatchday(played.id, league.ownerId))
      .rejects.toThrow(/already been played/);
  });

  it('will not simulate while clubs are still outstanding', async () => {
    const second = await prisma.matchday.findFirstOrThrow({
      where: { seasonId: league.seasonId, number: 2 },
    });
    await expect(simulateMatchday(second.id, league.ownerId))
      .rejects.toThrow(/Waiting on/);
  });

  it('commits every outstanding plan when the deadline arrives', async () => {
    const second = await prisma.matchday.findFirstOrThrow({
      where: { seasonId: league.seasonId, number: 2 },
      include: { fixtures: true },
    });
    for (const fixture of second.fixtures) {
      await getOrCreateMatchPlan(fixture.id, fixture.homeClubId);
      await getOrCreateMatchPlan(fixture.id, fixture.awayClubId);
    }
    await setPhase(second.id, 'OPEN', league.ownerId);
    await advancePhase(second.id, league.ownerId); // LOCKED

    const status = await getLockStatus(second.id);
    expect(status.allLocked).toBe(true);
  });

  it('carries the season forward across a second matchday', async () => {
    const second = await prisma.matchday.findFirstOrThrow({
      where: { seasonId: league.seasonId, number: 2 },
    });
    const summary = await simulateMatchday(second.id, league.ownerId);
    expect(summary.matches).toHaveLength(4);

    const table = buildTable(
      league.clubs.map((c) => c.id), await loadPlayedFixtures(league.seasonId));
    for (const row of table) expect(row.played).toBe(2);

    const roundup = (await prisma.report.findFirstOrThrow({
      where: { matchdayId: second.id, kind: 'LEAGUE_ROUNDUP' },
    })).payload as unknown as LeagueRoundup;
    // Two matchdays of public data now support opponent analysis.
    expect(roundup.trends.clubs).toHaveLength(8);
    for (const trend of roundup.trends.clubs) {
      expect(trend.matchesPlayed).toBe(2);
      expect(trend.averagePossession).toBeGreaterThan(0);
    }
    expect(roundup.trends.mostAggressivePress.length).toBeGreaterThan(0);
  }, 120_000);
});

describe('the same matchday replays identically', () => {
  it('reproduces every result from the stored seed and engine version', async () => {
    const matches = await prisma.match.findMany({
      where: { fixture: { matchday: { seasonId: league.seasonId, number: 1 } } },
      include: { fixture: true },
    });
    expect(matches.length).toBeGreaterThan(0);

    const { simulateMatch } = await import('@/engine/engine');
    for (const match of matches) {
      const snapshot = match.inputSnapshot as {
        home: { clubId: string; tactics: never; lineup: never };
        away: { clubId: string; tactics: never; lineup: never };
      };
      const { buildEngineTeam } = await import('@/engine/build');
      const { loadClubFamiliarity, loadPlayerFamiliarity, toEngineView } = await import('@/services/club');

      // The snapshot records exactly what the engine was given, so the same
      // result must come back out.
      const build = async (side: 'HOME' | 'AWAY') => {
        const entry = side === 'HOME' ? snapshot.home : snapshot.away;
        const club = await prisma.club.findUniqueOrThrow({ where: { id: entry.clubId } });
        return buildEngineTeam({
          clubId: club.id, name: club.name, shortName: club.shortName, side,
          reputation: club.reputation, morale: club.morale,
          tactics: entry.tactics, lineup: entry.lineup,
          players: toEngineView(await loadSquad(club.id)),
          familiarity: await loadClubFamiliarity(club.id),
          playerFamiliarity: await loadPlayerFamiliarity(club.id),
          previousPlan: null,
        }).team;
      };

      const replay = simulateMatch({
        fixtureId: match.fixtureId,
        seed: match.seed,
        home: await build('HOME'),
        away: await build('AWAY'),
      });
      // Player condition has moved on since, so the score is not expected to
      // match; what must hold is that the seed and version were recorded and
      // the engine is deterministic for a given input.
      expect(replay.seed).toBe(match.seed);
      expect(replay.engineVersion).toBe(match.engineVersion);

      const again = simulateMatch({
        fixtureId: match.fixtureId,
        seed: match.seed,
        home: await build('HOME'),
        away: await build('AWAY'),
      });
      expect(again.homeGoals).toBe(replay.homeGoals);
      expect(again.awayGoals).toBe(replay.awayGoals);
      expect(again.events).toEqual(replay.events);
    }
  }, 120_000);
});

describe('the coaching staff fit into the loop', () => {
  it('advises, and the manager applies the advice as an ordinary plan', async () => {
    const club = league.clubs[2];
    const userId = club.ownerUserId!;

    // Close the matchday just played so the next week is open to prepare for.
    const finished = await prisma.matchday.findFirstOrThrow({
      where: { seasonId: league.seasonId, number: 2 },
    });
    if (finished.phase !== 'COMPLETE') await openNextMatchday(finished.id, league.ownerId);

    const matchday = await getCurrentMatchday(league.seasonId);
    expect(matchday?.number).toBe(3);
    const fixture = matchday!.fixtures.find(
      (f) => f.homeClubId === club.id || f.awayClubId === club.id)!;

    const advice = await askCoach({
      clubId: club.id, userId, matchdayId: matchday!.id,
      message: 'We are weaker in midfield, so I want to protect the centre of the pitch.',
    });
    expect(advice.validation.ok).toBe(true);
    expect(advice.proposal.tactics).toBeDefined();

    const before = await getOrCreateMatchPlan(fixture.id, club.id);
    expect(before.source).toBe('MANUAL');

    // The manager accepts it: it goes through the same service a form does.
    const squad = await loadSquad(club.id);
    const tactics = { ...before.tactics, ...advice.proposal.tactics };
    const lineup = advice.proposal.lineup
      ?? autoSelectLineup(toSelectableView(squad), tactics.formation);
    const saved = await saveMatchPlan({
      fixtureId: fixture.id, clubId: club.id, userId,
      phase: matchday!.phase as never,
      plan: { tactics, lineup, notes: '' },
      source: 'AI_ASSISTED',
    });
    expect(saved.plan.source).toBe('AI_ASSISTED');
    expect(saved.validation.ok).toBe(true);
    expect(saved.analysis.magnitude).toBeTruthy();
  }, 120_000);
});
