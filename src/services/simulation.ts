import { prisma } from '@/lib/db';
import { progressFamiliarity } from '@/domain/familiarity';
import { buildTable, type PlayedFixture } from '@/domain/league/standings';
import { getFormation } from '@/domain/tactics/formations';
import { positionSuitability } from '@/domain/tactics/suitability';
import { buildMatchFacts, narrateMatch, type MatchFacts } from '@/domain/reports/match';
import { buildLeagueRoundup } from '@/domain/reports/roundup';
import { lineupSelectionSchema, type LineupSelectionInput, type TacticalPlanInput } from '@/domain/schemas';
import { ROLE_DEFINITIONS } from '@/domain/tactics/roles';
import { autoSelectLineup, defaultTacticalPlan } from '@/domain/tactics/selection';
import type { AttributeKey, Position } from '@/domain/types';
import {
  applyMatchAftermath, applyTrainingWeek, clubMorale, type WeeklyPlayerState,
} from '@/domain/weekly/progression';
import { buildEngineTeam } from '@/engine/build';
import { ENGINE_VERSION, simulateMatch } from '@/engine/engine';
import { createRng, fixtureSeed } from '@/engine/rng';
import type { MatchResult } from '@/engine/types';
import { recordAudit } from './audit';
import {
  loadClubFamiliarity, loadPlayerFamiliarity, loadSquad, saveClubFamiliarity,
  savePlayerFamiliarity, toEngineView, toSelectableView, type SquadPlayer,
} from './club';
import { getLockStatus, setPhase } from './matchday';
import { getOrCreateMatchPlan, getPreviousPlayedPlan, toTacticalInput, toTrainingInput, defaultTrainingPlan } from './plans';

/**
 * Running a matchday.
 *
 * The order matters and mirrors a real week: the squad trains, which moves
 * fitness, sharpness and tactical familiarity; the fixtures are then simulated
 * with those updated inputs; and only afterwards are form, morale, injuries,
 * suspensions and the league table brought up to date.
 *
 * Nothing in this file calls the AI layer.
 */

export class SimulationError extends Error {}

export interface SimulationSummary {
  matchdayId: string;
  matchdayNumber: number;
  matches: Array<{ fixtureId: string; homeClub: string; awayClub: string; homeGoals: number; awayGoals: number }>;
  reportId: string;
}

export async function simulateMatchday(
  matchdayId: string, userId: string, options: { force?: boolean } = {},
): Promise<SimulationSummary> {
  const matchday = await prisma.matchday.findUnique({
    where: { id: matchdayId },
    include: {
      season: { include: { league: true } },
      fixtures: { include: { homeClub: true, awayClub: true, match: true } },
    },
  });
  if (!matchday) throw new SimulationError('Matchday not found.');
  if (matchday.fixtures.some((f) => f.match)) {
    throw new SimulationError('This matchday has already been simulated.');
  }

  const lockStatus = await getLockStatus(matchdayId);
  if (!lockStatus.allLocked && !options.force) {
    throw new SimulationError(
      `Waiting on ${lockStatus.outstanding.length} club${lockStatus.outstanding.length === 1 ? '' : 's'} to lock in: ${lockStatus.outstanding.map((c) => c.clubName).join(', ')}.`);
  }

  await setPhase(matchdayId, 'SIMULATION', userId);

  const clubIds = [...new Set(matchday.fixtures.flatMap((f) => [f.homeClubId, f.awayClubId]))];

  // --- 1. The week's training ---------------------------------------------
  const trainedSquads = new Map<string, SquadPlayer[]>();
  for (const clubId of clubIds) {
    trainedSquads.set(clubId, await applyWeeklyTraining(clubId, matchday.id, matchday.number, matchday.seasonId));
  }

  // --- 2. Simulate every fixture ------------------------------------------
  const results: Array<{ fixtureId: string; result: MatchResult; facts: MatchFacts }> = [];
  for (const fixture of matchday.fixtures) {
    const outcome = await simulateFixture({
      fixtureId: fixture.id,
      seasonId: matchday.seasonId,
      matchdayNumber: matchday.number,
      homeClubId: fixture.homeClubId,
      awayClubId: fixture.awayClubId,
      squads: trainedSquads,
    });
    results.push(outcome);
  }

  // --- 3. Aftermath: player states, morale, familiarity --------------------
  for (const fixture of matchday.fixtures) {
    const entry = results.find((r) => r.fixtureId === fixture.id);
    if (!entry) continue;
    await applyAftermath(fixture.homeClubId, entry.result, 'HOME', matchday.number, matchday.seasonId);
    await applyAftermath(fixture.awayClubId, entry.result, 'AWAY', matchday.number, matchday.seasonId);
  }

  // --- 4. League table snapshot -------------------------------------------
  await snapshotStandings(matchday.seasonId, matchday.id, matchday.number);

  // --- 5. Reports ----------------------------------------------------------
  const report = await publishReports(matchday.seasonId, matchday.id, matchday.number, results.map((r) => r.facts));

  await prisma.matchday.update({
    where: { id: matchdayId },
    data: { phase: 'POST_MATCH', simulatedAt: new Date() },
  });
  await prisma.fixture.updateMany({ where: { matchdayId }, data: { status: 'PLAYED' } });
  await recordAudit({
    action: 'MATCHDAY_SIMULATED', entity: 'Matchday', entityId: matchdayId, userId,
    after: { engineVersion: ENGINE_VERSION, fixtures: results.length },
  });

  return {
    matchdayId,
    matchdayNumber: matchday.number,
    matches: results.map((r) => ({
      fixtureId: r.fixtureId,
      homeClub: r.facts.home.name,
      awayClub: r.facts.away.name,
      homeGoals: r.facts.homeGoals,
      awayGoals: r.facts.awayGoals,
    })),
    reportId: report.id,
  };
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

function roleAttributeTargets(role: string): AttributeKey[] {
  return ROLE_DEFINITIONS[role as keyof typeof ROLE_DEFINITIONS]?.keyAttributes ?? [];
}

async function applyWeeklyTraining(
  clubId: string, matchdayId: string, matchdayNumber: number, seasonId: string,
): Promise<SquadPlayer[]> {
  const rng = createRng(`training:${seasonId}:${matchdayNumber}:${clubId}`);
  const squad = await loadSquad(clubId);

  const trainingRow = await prisma.trainingPlan.findUnique({
    where: { clubId_matchdayId: { clubId, matchdayId } },
  });
  const training = trainingRow ? toTrainingInput(trainingRow) : defaultTrainingPlan();
  const individualRoles = new Map(training.individualFocus.map((f) => [f.playerId, f.role]));

  const states: WeeklyPlayerState[] = squad.map((p) => ({
    playerId: p.id,
    age: p.age,
    potential: p.potential,
    fitness: p.fitness,
    fatigue: p.fatigue,
    morale: p.morale,
    form: p.form,
    confidence: p.confidence,
    matchSharpness: p.matchSharpness,
    injury: p.injury as WeeklyPlayerState['injury'],
    injuryDescription: p.injuryDescription,
    injuryWeeksLeft: p.injuryWeeksLeft,
    suspensionMatches: p.suspensionMatches,
    yellowCardsSeason: p.yellowCardsSeason,
    redCardsSeason: p.redCardsSeason,
    attributes: p.attributes,
    individualRoleAttributes: individualRoles.has(p.id)
      ? roleAttributeTargets(individualRoles.get(p.id)!)
      : undefined,
  }));

  const outcome = applyTrainingWeek(states, training, rng);
  await persistPlayerStates(outcome.states);

  // Familiarity gained on the training ground, available for this week's match.
  const fixture = await prisma.fixture.findFirst({
    where: { matchdayId, OR: [{ homeClubId: clubId }, { awayClubId: clubId }] },
  });
  const plan = fixture ? await getOrCreateMatchPlan(fixture.id, clubId) : null;
  const [familiarity, playerFamiliarity, lastWeekStarters] = await Promise.all([
    loadClubFamiliarity(clubId),
    loadPlayerFamiliarity(clubId),
    previousStarters(clubId),
  ]);

  const startersThisWeek = (plan?.lineup.starters ?? []).map((s) => ({
    playerId: s.playerId,
    role: s.role,
    position: slotPosition(plan!.tactics.formation, s.slot),
  }));

  const progressed = progressFamiliarity({
    familiarity,
    playerFamiliarity,
    training,
    plan: plan?.tactics ?? null,
    playedPlan: null,
    startersThisWeek,
    startersLastWeek: lastWeekStarters,
    applyDecay: true,
  });
  await saveClubFamiliarity(clubId, progressed.familiarity);
  await savePlayerFamiliarity(progressed.playerFamiliarity);

  await prisma.trainingPlan.updateMany({
    where: { clubId, matchdayId },
    data: {
      appliedEffects: {
        notes: outcome.notes,
        injuries: outcome.newInjuries,
        developments: outcome.developments.slice(0, 12),
      } as never,
    },
  });

  return loadSquad(clubId);
}

function slotPosition(formation: string, slotKey: string): Position {
  return getFormation(formation as never).slots.find((s) => s.key === slotKey)?.position ?? 'MC';
}

async function previousStarters(clubId: string): Promise<string[]> {
  const plan = await prisma.matchPlan.findFirst({
    where: { clubId, fixture: { match: { isNot: null } } },
    orderBy: { fixture: { matchday: { number: 'desc' } } },
    include: { lineup: { include: { assignments: true } } },
  });
  return plan?.lineup?.assignments.filter((a) => a.isStarter).map((a) => a.playerId) ?? [];
}

async function persistPlayerStates(states: WeeklyPlayerState[]): Promise<void> {
  for (let i = 0; i < states.length; i += 25) {
    await prisma.$transaction(states.slice(i, i + 25).flatMap((s) => [
      prisma.playerState.update({
        where: { playerId: s.playerId },
        data: {
          fitness: Math.round(s.fitness),
          fatigue: Math.round(s.fatigue),
          morale: Math.round(s.morale),
          form: Math.round(s.form),
          confidence: Math.round(s.confidence),
          matchSharpness: Math.round(s.matchSharpness),
          injury: s.injury,
          injuryDescription: s.injuryDescription,
          injuryWeeksLeft: s.injuryWeeksLeft,
          suspensionMatches: s.suspensionMatches,
          yellowCardsSeason: s.yellowCardsSeason,
          redCardsSeason: s.redCardsSeason,
        },
      }),
      prisma.playerAttribute.update({ where: { playerId: s.playerId }, data: s.attributes }),
    ]));
  }
}

// ---------------------------------------------------------------------------
// One fixture
// ---------------------------------------------------------------------------

interface SimulateFixtureInput {
  fixtureId: string;
  seasonId: string;
  matchdayNumber: number;
  homeClubId: string;
  awayClubId: string;
  squads: Map<string, SquadPlayer[]>;
}

async function simulateFixture(input: SimulateFixtureInput) {
  const [homeSide, awaySide] = await Promise.all([
    prepareSide(input.fixtureId, input.homeClubId, 'HOME', input.squads),
    prepareSide(input.fixtureId, input.awayClubId, 'AWAY', input.squads),
  ]);

  const seed = fixtureSeed(input.seasonId, input.matchdayNumber, input.fixtureId);
  const result = simulateMatch({
    fixtureId: input.fixtureId,
    seed,
    home: homeSide.built.team,
    away: awaySide.built.team,
  });

  const playerNames: Record<string, string> = {};
  const playerPositions: Record<string, string> = {};
  for (const squad of [homeSide.squad, awaySide.squad]) {
    for (const player of squad) {
      playerNames[player.id] = player.name;
      playerPositions[player.id] = player.primaryPosition;
    }
  }

  const facts = buildMatchFacts(result, {
    clubs: {
      [homeSide.club.id]: { id: homeSide.club.id, name: homeSide.club.name, shortName: homeSide.club.shortName },
      [awaySide.club.id]: { id: awaySide.club.id, name: awaySide.club.name, shortName: awaySide.club.shortName },
    },
    playerNames,
    playerPositions,
    homeClubId: input.homeClubId,
    awayClubId: input.awayClubId,
    homeTactics: homeSide.tactics,
    awayTactics: awaySide.tactics,
  });

  await persistMatch(input.fixtureId, result, {
    home: { clubId: input.homeClubId, tactics: homeSide.tactics, lineup: homeSide.lineup },
    away: { clubId: input.awayClubId, tactics: awaySide.tactics, lineup: awaySide.lineup },
  });

  return { fixtureId: input.fixtureId, result, facts };
}

async function prepareSide(
  fixtureId: string, clubId: string, side: 'HOME' | 'AWAY', squads: Map<string, SquadPlayer[]>,
) {
  const club = await prisma.club.findUniqueOrThrow({ where: { id: clubId } });
  const squad = squads.get(clubId) ?? await loadSquad(clubId);

  const stored = await prisma.matchPlan.findUnique({
    where: { fixtureId_clubId: { fixtureId, clubId } },
    include: { tactics: true, lineup: { include: { assignments: true } } },
  });

  let tactics: TacticalPlanInput;
  let lineup: LineupSelectionInput;

  if (stored?.tactics && stored.lineup && stored.lineup.assignments.length > 0) {
    tactics = toTacticalInput(stored.tactics);
    lineup = lineupSelectionSchema.parse({
      starters: stored.lineup.assignments.filter((a) => a.isStarter)
        .map((a) => ({ slot: a.slot, playerId: a.playerId, role: a.role })),
      bench: stored.lineup.assignments.filter((a) => !a.isStarter)
        .map((a, i) => ({ playerId: a.playerId, order: a.benchOrder ?? i })),
      captainPlayerId: stored.lineup.captainPlayerId ?? undefined,
    });
    lineup = repairLineup(lineup, tactics, squad);
  } else {
    // A club that submitted nothing still fields a side: the league must play on.
    tactics = defaultTacticalPlan();
    lineup = autoSelectLineup(toSelectableView(squad), tactics.formation);
  }

  const [familiarity, playerFamiliarity, previousPlan] = await Promise.all([
    loadClubFamiliarity(clubId),
    loadPlayerFamiliarity(clubId),
    getPreviousPlayedPlan(clubId),
  ]);

  const built = buildEngineTeam({
    clubId,
    name: club.name,
    shortName: club.shortName,
    side,
    reputation: club.reputation,
    morale: club.morale,
    tactics,
    lineup,
    players: toEngineView(squad),
    familiarity,
    playerFamiliarity,
    previousPlan,
  });

  return { club, squad, tactics, lineup, built };
}

/**
 * A locked line-up can be invalidated by a training-ground injury during the
 * week. Rather than refusing to play the fixture, the closest available
 * replacement is promoted from the bench.
 */
function repairLineup(
  lineup: LineupSelectionInput, tactics: TacticalPlanInput, squad: SquadPlayer[],
): LineupSelectionInput {
  const byId = new Map(squad.map((p) => [p.id, p]));
  const unavailable = (id: string) => {
    const player = byId.get(id);
    return !player || player.injury !== 'NONE' || player.suspensionMatches > 0;
  };
  if (!lineup.starters.some((s) => unavailable(s.playerId))
    && !lineup.bench.some((b) => unavailable(b.playerId))) {
    return lineup;
  }

  const used = new Set(lineup.starters.map((s) => s.playerId));
  const bench = lineup.bench.filter((b) => !unavailable(b.playerId));
  const spare = squad.filter((p) => p.injury === 'NONE' && p.suspensionMatches === 0 && !used.has(p.id));

  const starters = lineup.starters.map((entry) => {
    if (!unavailable(entry.playerId)) return entry;
    used.delete(entry.playerId);
    const slot = tactics.formation;
    const replacement = pickReplacement(entry.slot, slot, spare, used);
    if (!replacement) return entry;
    used.add(replacement.id);
    return { ...entry, playerId: replacement.id };
  });

  return {
    starters,
    bench: bench.filter((b) => !used.has(b.playerId)).map((b, i) => ({ playerId: b.playerId, order: i })),
    captainPlayerId: starters.some((s) => s.playerId === lineup.captainPlayerId)
      ? lineup.captainPlayerId : starters[0]?.playerId,
  };
}

function pickReplacement(
  slotKey: string, formation: string, pool: SquadPlayer[], used: Set<string>,
): SquadPlayer | undefined {
  const position = slotPosition(formation, slotKey);
  return pool
    .filter((p) => !used.has(p.id))
    .sort((a, b) =>
      positionSuitability(b, position) * b.overall - positionSuitability(a, position) * a.overall)[0];
}

async function persistMatch(
  fixtureId: string,
  result: MatchResult,
  sides: {
    home: { clubId: string; tactics: TacticalPlanInput; lineup: LineupSelectionInput };
    away: { clubId: string; tactics: TacticalPlanInput; lineup: LineupSelectionInput };
  },
): Promise<void> {
  const match = await prisma.match.create({
    data: {
      fixtureId,
      engineVersion: result.engineVersion,
      seed: result.seed,
      homeGoals: result.homeGoals,
      awayGoals: result.awayGoals,
      // Storing the exact input makes every result reproducible and auditable.
      inputSnapshot: JSON.parse(JSON.stringify(sides)),
    },
  });

  const playerIds = new Set(result.performances.map((p) => p.playerId));
  await prisma.matchEvent.createMany({
    data: result.events.map((event) => ({
      matchId: match.id,
      sequence: event.sequence,
      minute: event.minute,
      type: event.type,
      side: event.side,
      playerId: event.playerId && playerIds.has(event.playerId) ? event.playerId : null,
      secondaryPlayerId: event.secondaryPlayerId && playerIds.has(event.secondaryPlayerId) ? event.secondaryPlayerId : null,
      detail: event.detail as never,
      description: event.description,
    })),
  });

  for (const side of ['HOME', 'AWAY'] as const) {
    const stats = result.stats[side];
    await prisma.matchStatistic.create({
      data: {
        matchId: match.id,
        side,
        possession: stats.possession,
        shots: stats.shots,
        shotsOnTarget: stats.shotsOnTarget,
        expectedGoals: stats.expectedGoals,
        passes: stats.passes,
        passesCompleted: stats.passesCompleted,
        fouls: stats.fouls,
        yellowCards: stats.yellowCards,
        redCards: stats.redCards,
        corners: stats.corners,
        offsides: stats.offsides,
        tackles: stats.tackles,
        interceptions: stats.interceptions,
        pressingActions: stats.pressingActions,
        saves: stats.saves,
        bigChances: stats.bigChances,
        tacticalSummary: stats.tacticalSummary as never,
      },
    });
  }

  await prisma.playerMatchPerformance.createMany({
    data: result.performances.map((p) => ({
      matchId: match.id,
      playerId: p.playerId,
      clubId: p.side === 'HOME' ? sides.home.clubId : sides.away.clubId,
      side: p.side,
      minutesPlayed: p.minutesPlayed,
      position: p.position,
      role: p.role,
      rating: p.rating,
      goals: p.goals,
      assists: p.assists,
      shots: p.shots,
      shotsOnTarget: p.shotsOnTarget,
      expectedGoals: p.expectedGoals,
      passes: p.passes,
      passesCompleted: p.passesCompleted,
      keyPasses: p.keyPasses,
      tackles: p.tackles,
      interceptions: p.interceptions,
      saves: p.saves,
      fouls: p.fouls,
      yellowCard: p.yellowCard,
      redCard: p.redCard,
      injured: p.injured,
    })),
  });
}

// ---------------------------------------------------------------------------
// Aftermath
// ---------------------------------------------------------------------------

async function applyAftermath(
  clubId: string, result: MatchResult, side: 'HOME' | 'AWAY',
  matchdayNumber: number, seasonId: string,
): Promise<void> {
  const rng = createRng(`aftermath:${seasonId}:${matchdayNumber}:${clubId}`);
  const squad = await loadSquad(clubId);
  const performances = new Map(result.performances.filter((p) => p.side === side).map((p) => [p.playerId, p]));

  const goalsFor = side === 'HOME' ? result.homeGoals : result.awayGoals;
  const goalsAgainst = side === 'HOME' ? result.awayGoals : result.homeGoals;
  const outcome = goalsFor > goalsAgainst ? 'WIN' : goalsFor === goalsAgainst ? 'DRAW' : 'LOSS';

  const states = squad.map((p) => applyMatchAftermath({
    state: {
      playerId: p.id, age: p.age, potential: p.potential, fitness: p.fitness,
      fatigue: p.fatigue, morale: p.morale, form: p.form, confidence: p.confidence,
      matchSharpness: p.matchSharpness, injury: p.injury as never,
      injuryDescription: p.injuryDescription, injuryWeeksLeft: p.injuryWeeksLeft,
      suspensionMatches: p.suspensionMatches, yellowCardsSeason: p.yellowCardsSeason,
      redCardsSeason: p.redCardsSeason, attributes: p.attributes,
    },
    performance: performances.get(p.id),
    outcome,
    goalDifference: goalsFor - goalsAgainst,
    rng,
  }));
  await persistPlayerStates(states);

  // Season totals.
  for (const [playerId, performance] of performances) {
    await prisma.playerState.update({
      where: { playerId },
      data: {
        appearances: { increment: performance.minutesPlayed > 0 ? 1 : 0 },
        goals: { increment: performance.goals },
        assists: { increment: performance.assists },
        minutes: { increment: performance.minutesPlayed },
        ratingSum: { increment: performance.rating },
      },
    });
  }

  const history = await prisma.clubHistory.findFirst({
    where: { clubId }, orderBy: { matchdayNumber: 'desc' },
  });
  const form = `${history?.formGuide ?? ''}${outcome === 'WIN' ? 'W' : outcome === 'DRAW' ? 'D' : 'L'}`.slice(-5);
  await prisma.club.update({
    where: { id: clubId },
    data: { morale: clubMorale(states, form) },
  });

  // The system the side has just played becomes a little more familiar.
  const played = await getPreviousPlayedPlan(clubId);
  if (played) {
    const [familiarity, playerFamiliarity] = await Promise.all([
      loadClubFamiliarity(clubId), loadPlayerFamiliarity(clubId),
    ]);
    const starters = result.performances
      .filter((p) => p.side === side && p.minutesPlayed >= 45)
      .map((p) => ({ playerId: p.playerId, role: p.role, position: p.position }));
    const progressed = progressFamiliarity({
      familiarity,
      playerFamiliarity,
      training: defaultTrainingPlan(),
      plan: played,
      playedPlan: played,
      startersThisWeek: starters,
      startersLastWeek: [],
      applyDecay: false,
    });
    await saveClubFamiliarity(clubId, progressed.familiarity);
    await savePlayerFamiliarity(progressed.playerFamiliarity);
  }
}

// ---------------------------------------------------------------------------
// Standings and reports
// ---------------------------------------------------------------------------

export async function loadPlayedFixtures(seasonId: string): Promise<PlayedFixture[]> {
  const fixtures = await prisma.fixture.findMany({
    where: { seasonId, match: { isNot: null } },
    include: { match: true, matchday: true },
  });
  return fixtures
    .filter((f) => f.match)
    .map((f) => ({
      matchdayNumber: f.matchday.number,
      homeClubId: f.homeClubId,
      awayClubId: f.awayClubId,
      homeGoals: f.match!.homeGoals,
      awayGoals: f.match!.awayGoals,
    }));
}

async function snapshotStandings(seasonId: string, matchdayId: string, matchdayNumber: number): Promise<void> {
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: seasonId }, include: { league: { include: { clubs: true } } },
  });
  const clubIds = season.league.clubs.map((c) => c.id);
  const table = buildTable(clubIds, await loadPlayedFixtures(seasonId));

  for (const row of table) {
    await prisma.clubHistory.upsert({
      where: { clubId_matchdayId: { clubId: row.clubId, matchdayId } },
      create: {
        clubId: row.clubId, seasonId, matchdayId, matchdayNumber,
        position: row.position, played: row.played, won: row.won, drawn: row.drawn,
        lost: row.lost, goalsFor: row.goalsFor, goalsAgainst: row.goalsAgainst,
        points: row.points, formGuide: row.formGuide,
      },
      update: {
        position: row.position, played: row.played, won: row.won, drawn: row.drawn,
        lost: row.lost, goalsFor: row.goalsFor, goalsAgainst: row.goalsAgainst,
        points: row.points, formGuide: row.formGuide,
      },
    });
  }
}

async function publishReports(
  seasonId: string, matchdayId: string, matchdayNumber: number, facts: MatchFacts[],
) {
  // Per-match reports.
  for (const match of facts) {
    const narrative = narrateMatch(match);
    await prisma.report.create({
      data: {
        seasonId, matchdayId, fixtureId: match.fixtureId,
        kind: 'MATCH_REPORT',
        payload: JSON.parse(JSON.stringify(match)),
        narrative,
      },
    });
  }

  const season = await prisma.season.findUniqueOrThrow({
    where: { id: seasonId }, include: { league: { include: { clubs: true } } },
  });
  const clubNames: Record<string, string> = {};
  for (const club of season.league.clubs) clubNames[club.id] = club.name;

  const table = buildTable(season.league.clubs.map((c) => c.id), await loadPlayedFixtures(seasonId))
    .map((row) => ({ ...row, clubName: clubNames[row.clubId] ?? row.clubId }));

  const seasonFacts = await loadSeasonFacts(seasonId);

  const injured = await prisma.player.findMany({
    where: { clubId: { in: season.league.clubs.map((c) => c.id) }, state: { injuryWeeksLeft: { gt: 0 } } },
    include: { state: true, club: true },
  });
  const suspended = await prisma.player.findMany({
    where: { clubId: { in: season.league.clubs.map((c) => c.id) }, state: { suspensionMatches: { gt: 0 } } },
    include: { state: true, club: true },
  });

  const roundup = buildLeagueRoundup({
    matchdayNumber,
    facts,
    table,
    seasonFacts,
    clubNames,
    publicInjuries: injured.map((p) => ({
      playerName: `${p.firstName} ${p.lastName}`,
      clubName: p.club.name,
      note: `${p.state?.injuryDescription ?? 'Injured'} — out for ${p.state?.injuryWeeksLeft} week${p.state?.injuryWeeksLeft === 1 ? '' : 's'}`,
    })),
    suspensions: suspended.map((p) => ({
      playerName: `${p.firstName} ${p.lastName}`,
      clubName: p.club.name,
      matches: p.state?.suspensionMatches ?? 0,
    })),
  });
  roundup.results = roundup.results.map((r) => ({
    ...r,
    narrative: narrateMatch(facts.find((f) => f.fixtureId === r.fixtureId)!),
  }));

  return prisma.report.create({
    data: {
      seasonId, matchdayId, kind: 'LEAGUE_ROUNDUP',
      payload: JSON.parse(JSON.stringify(roundup)),
      narrative: roundup.headlines.join(' '),
    },
  });
}

export async function loadSeasonFacts(seasonId: string): Promise<MatchFacts[]> {
  const reports = await prisma.report.findMany({
    where: { seasonId, kind: 'MATCH_REPORT' },
    orderBy: { publishedAt: 'asc' },
  });
  return reports.map((r) => r.payload as unknown as MatchFacts);
}

/** Open the following matchday once the league has digested this one. */
export async function openNextMatchday(matchdayId: string, userId: string) {
  const matchday = await prisma.matchday.findUniqueOrThrow({ where: { id: matchdayId } });
  await prisma.matchday.update({ where: { id: matchdayId }, data: { phase: 'COMPLETE' } });
  const next = await prisma.matchday.findFirst({
    where: { seasonId: matchday.seasonId, number: matchday.number + 1 },
  });
  if (next) {
    await prisma.matchday.update({ where: { id: next.id }, data: { phase: 'WEEK_OPEN' } });
  } else {
    await prisma.season.update({ where: { id: matchday.seasonId }, data: { status: 'COMPLETE' } });
  }
  await recordAudit({
    action: 'MATCHDAY_CLOSED', entity: 'Matchday', entityId: matchdayId, userId,
    after: { nextMatchday: next?.number ?? null },
  });
  return next;
}
