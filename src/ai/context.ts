import { prisma } from '@/lib/db';
import { familiarityFor, overallTacticalStability } from '@/domain/familiarity';
import { buildTable } from '@/domain/league/standings';
import { buildClubTrends } from '@/domain/reports/roundup';
import type { MatchFacts } from '@/domain/reports/match';
import type { TacticalPlanInput, TrainingPlanInput } from '@/domain/schemas';
import { FORMATION_DEFINITIONS, getFormation } from '@/domain/tactics/formations';
import { ROLE_DEFINITIONS } from '@/domain/tactics/roles';
import { defaultTacticalPlan } from '@/domain/tactics/selection';
import type { MatchdayPhase, Position } from '@/domain/types';
import { scoutOpponent, type ScoutingView } from '@/domain/visibility';
import { loadClubFamiliarity, loadSquad, type SquadPlayer } from '@/services/club';
import {
  defaultTrainingPlan, getOrCreateMatchPlan, getOrCreateTrainingPlan, toTrainingInput,
} from '@/services/plans';
import { loadPlayedFixtures, loadSeasonFacts } from '@/services/simulation';
import { clean } from './sanitize';

/**
 * Everything the coaching staff is allowed to know.
 *
 * This is the fairness and privacy boundary. It contains the manager's own club
 * in full and the opponent only as public results and inferred tendencies. No
 * opponent squad, plan, training or conversation can reach the model, because
 * none of it is loaded here.
 */

export interface CoachSquadPlayer {
  id: string;
  name: string;
  position: Position;
  secondaryPositions: Position[];
  age: number;
  overall: number;
  fitness: number;
  form: number;
  morale: number;
  sharpness: number;
  available: boolean;
  status: string;
  standout: string[];
}

export interface CoachContext {
  club: {
    name: string;
    nickname: string | null;
    reputation: number;
    morale: number;
    philosophy: string;
    coachName: string;
    coachPersona: string;
  };
  fixture: {
    matchdayNumber: number;
    phase: MatchdayPhase;
    opponentName: string;
    opponentClubId: string;
    venue: 'HOME' | 'AWAY';
    deadline: string | null;
  } | null;
  league: {
    position: number | null;
    points: number;
    formGuide: string;
    table: Array<{ position: number; clubName: string; played: number; points: number; goalDifference: number }>;
  };
  squad: CoachSquadPlayer[];
  familiarity: {
    formation: number;
    playingStyle: number;
    pressing: number;
    defensiveOrganisation: number;
    buildUp: number;
    transition: number;
    setPieces: number;
    overallStability: number;
    bestKnownFormations: Array<{ formation: string; label: string; value: number }>;
  };
  currentPlan: TacticalPlanInput;
  currentTraining: TrainingPlanInput;
  opponent: ScoutingView | null;
  recentMatches: Array<{
    opponent: string; venue: 'HOME' | 'AWAY'; score: string;
    result: 'W' | 'D' | 'L'; possession: number; shots: number; expectedGoals: number;
  }>;
  availableFormations: Array<{ formation: string; label: string; description: string; familiarity: number }>;
  availableRoles: Array<{ role: string; label: string; positions: string[] }>;
  /** Set when something instruction-shaped was found in stored text. */
  sanitisationFlags: string[];
}

const KEEPER_ATTRIBUTES = ['reflexes', 'handling', 'oneOnOnes', 'distribution', 'positioning', 'concentration'];

function standoutAttributes(player: SquadPlayer): string[] {
  const isKeeper = player.primaryPosition === 'GK';
  return Object.entries(player.attributes)
    .filter(([key]) => (isKeeper
      ? KEEPER_ATTRIBUTES.includes(key)
      : !['handling', 'reflexes', 'oneOnOnes', 'distribution'].includes(key)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key, value]) => `${key} ${value}`);
}

export async function buildCoachContext(clubId: string): Promise<CoachContext> {
  const club = await prisma.club.findUniqueOrThrow({
    where: { id: clubId },
    include: { aiManager: true, league: { include: { clubs: true } } },
  });

  const season = await prisma.season.findFirst({
    where: { leagueId: club.leagueId, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  });

  const matchday = season
    ? await prisma.matchday.findFirst({
      where: { seasonId: season.id, phase: { not: 'COMPLETE' } },
      orderBy: { number: 'asc' },
    })
    : null;

  const fixture = matchday
    ? await prisma.fixture.findFirst({
      where: { matchdayId: matchday.id, OR: [{ homeClubId: clubId }, { awayClubId: clubId }] },
      include: { homeClub: true, awayClub: true },
    })
    : null;

  const [squad, familiarity] = await Promise.all([loadSquad(clubId), loadClubFamiliarity(clubId)]);

  const currentPlan = fixture
    ? (await getOrCreateMatchPlan(fixture.id, clubId, squad)).tactics
    : defaultTacticalPlan();
  const trainingRow = matchday ? await getOrCreateTrainingPlan(clubId, matchday.id) : null;
  const currentTraining = trainingRow ? toTrainingInput(trainingRow) : defaultTrainingPlan();
  const familiarityValues = familiarityFor(familiarity, currentPlan);

  // Public league information only.
  const clubIds = club.league.clubs.map((c) => c.id);
  const clubNames: Record<string, string> = {};
  for (const c of club.league.clubs) clubNames[c.id] = c.name;
  const playedFixtures = season ? await loadPlayedFixtures(season.id) : [];
  const table = buildTable(clubIds, playedFixtures);
  const own = table.find((r) => r.clubId === clubId);

  const seasonFacts: MatchFacts[] = season ? await loadSeasonFacts(season.id) : [];
  const opponentClubId = fixture
    ? (fixture.homeClubId === clubId ? fixture.awayClubId : fixture.homeClubId)
    : null;

  let opponent: ScoutingView | null = null;
  if (opponentClubId) {
    const trend = buildClubTrends(seasonFacts, clubNames).clubs
      .find((c) => c.clubId === opponentClubId);
    opponent = trend ? scoutOpponent(trend) : null;
  }

  const recentMatches = seasonFacts
    .filter((m) => m.home.clubId === clubId || m.away.clubId === clubId)
    .slice(-5)
    .map((m) => {
      const isHome = m.home.clubId === clubId;
      const us = isHome ? m.home : m.away;
      const them = isHome ? m.away : m.home;
      return {
        opponent: clean(them.name, 80),
        venue: (isHome ? 'HOME' : 'AWAY') as 'HOME' | 'AWAY',
        score: `${us.goals}-${them.goals}`,
        result: (us.goals > them.goals ? 'W' : us.goals === them.goals ? 'D' : 'L') as 'W' | 'D' | 'L',
        possession: us.possession,
        shots: us.shots,
        expectedGoals: us.expectedGoals,
      };
    });

  const flags: string[] = [];
  const rawPhilosophy = club.aiManager?.philosophy ?? '';
  const philosophy = clean(rawPhilosophy, 600);
  if (philosophy !== rawPhilosophy.trim()) flags.push('club philosophy');

  return {
    club: {
      name: clean(club.name, 80),
      nickname: club.nickname ? clean(club.nickname, 60) : null,
      reputation: club.reputation,
      morale: club.morale,
      philosophy,
      coachName: clean(club.aiManager?.name ?? 'Coaching staff', 60),
      coachPersona: clean(club.aiManager?.persona ?? '', 300),
    },
    fixture: fixture && matchday ? {
      matchdayNumber: matchday.number,
      phase: matchday.phase as MatchdayPhase,
      opponentName: clean(fixture.homeClubId === clubId ? fixture.awayClub.name : fixture.homeClub.name, 80),
      opponentClubId: opponentClubId as string,
      venue: fixture.homeClubId === clubId ? 'HOME' : 'AWAY',
      deadline: matchday.deadlineAt ? matchday.deadlineAt.toISOString() : null,
    } : null,
    league: {
      position: own ? own.position : null,
      points: own ? own.points : 0,
      formGuide: own ? own.formGuide : '',
      table: table.map((r) => ({
        position: r.position,
        clubName: clean(clubNames[r.clubId] ?? r.clubId, 80),
        played: r.played,
        points: r.points,
        goalDifference: r.goalDifference,
      })),
    },
    squad: squad.map((p) => ({
      id: p.id,
      name: clean(p.name, 80),
      position: p.primaryPosition,
      secondaryPositions: p.secondaryPositions,
      age: p.age,
      overall: p.overall,
      fitness: Math.round(p.fitness),
      form: Math.round(p.form),
      morale: Math.round(p.morale),
      sharpness: Math.round(p.matchSharpness),
      available: p.available,
      status: p.injury !== 'NONE'
        ? `injured: ${clean(p.injuryDescription ?? 'unavailable', 60)} (${p.injuryWeeksLeft}w)`
        : p.suspensionMatches > 0 ? `suspended (${p.suspensionMatches})` : 'available',
      standout: standoutAttributes(p),
    })),
    familiarity: {
      formation: Math.round(familiarityValues.formation),
      playingStyle: Math.round(familiarityValues.playingStyle),
      pressing: Math.round(familiarityValues.pressing),
      defensiveOrganisation: Math.round(familiarityValues.defensiveOrganisation),
      buildUp: Math.round(familiarityValues.buildUp),
      transition: Math.round(familiarityValues.transition),
      setPieces: Math.round(familiarityValues.setPieces),
      overallStability: overallTacticalStability(familiarity, currentPlan),
      bestKnownFormations: Object.entries(familiarity.FORMATION)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        .slice(0, 3)
        .map(([formation, value]) => ({
          formation,
          label: getFormation(formation as never).label,
          value: Math.round(value ?? 0),
        })),
    },
    currentPlan,
    currentTraining,
    opponent,
    recentMatches,
    availableFormations: Object.values(FORMATION_DEFINITIONS).map((f) => ({
      formation: f.formation,
      label: f.label,
      description: f.description,
      familiarity: Math.round(familiarity.FORMATION[f.formation] ?? 30),
    })),
    availableRoles: Object.values(ROLE_DEFINITIONS).map((r) => ({
      role: r.role, label: r.label, positions: r.positions,
    })),
    sanitisationFlags: flags,
  };
}
