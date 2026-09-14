import type { MatchResult, TeamStats } from '@/engine/types';
import type { TacticalPlanInput } from '../schemas';
import { getFormation } from '../tactics/formations';
import type { TeamSide } from '../types';

/**
 * Match reporting.
 *
 * Every sentence in a report is generated from a recorded fact. The narrative
 * writer below is given a `MatchFacts` object and may only assemble sentences
 * from numbers that are already in it, which is also the contract for the AI
 * layer: it is handed these facts and never asked to invent an explanation.
 */

export interface TeamFacts {
  clubId: string;
  name: string;
  shortName: string;
  side: TeamSide;
  goals: number;
  formation: string;
  formationLabel: string;
  mentality: string;
  playingStyle: string;
  pressing: string;
  defensiveLine: string;
  possession: number;
  shots: number;
  shotsOnTarget: number;
  expectedGoals: number;
  passes: number;
  passAccuracy: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  corners: number;
  offsides: number;
  tackles: number;
  interceptions: number;
  pressingActions: number;
  pressingRate: number;
  territory: number;
  directness: number;
  saves: number;
  bigChances: number;
  counterAttackGoals: number;
  setPieceGoals: number;
  inMatchChanges: number;
  scorers: Array<{ playerId: string; name: string; minute: number; assist?: string; setPiece: boolean; counterAttack: boolean }>;
  substitutions: Array<{ minute: number; on: string; off: string; reason: string }>;
  bookings: Array<{ minute: number; name: string; type: 'YELLOW' | 'RED' }>;
  injuries: Array<{ minute: number; name: string }>;
  topPerformers: Array<{ playerId: string; name: string; rating: number; goals: number; assists: number; position: string }>;
}

export interface MatchFacts {
  fixtureId: string;
  engineVersion: string;
  seed: string;
  homeGoals: number;
  awayGoals: number;
  result: 'HOME_WIN' | 'AWAY_WIN' | 'DRAW';
  home: TeamFacts;
  away: TeamFacts;
  keyEvents: Array<{ minute: number; type: string; description: string; side?: TeamSide }>;
}

export interface ReportContext {
  clubs: Record<string, { id: string; name: string; shortName: string }>;
  playerNames: Record<string, string>;
  playerPositions: Record<string, string>;
  homeClubId: string;
  awayClubId: string;
  homeTactics: TacticalPlanInput;
  awayTactics: TacticalPlanInput;
}

const KEY_EVENT_TYPES = new Set([
  'GOAL', 'RED_CARD', 'PENALTY_MISSED', 'INJURY', 'SUBSTITUTION', 'TACTICAL_CHANGE', 'HALF_TIME', 'FULL_TIME',
]);

export function buildMatchFacts(result: MatchResult, context: ReportContext): MatchFacts {
  const home = teamFacts(result, context, 'HOME');
  const away = teamFacts(result, context, 'AWAY');
  return {
    fixtureId: result.fixtureId,
    engineVersion: result.engineVersion,
    seed: result.seed,
    homeGoals: result.homeGoals,
    awayGoals: result.awayGoals,
    result: result.homeGoals > result.awayGoals ? 'HOME_WIN'
      : result.homeGoals < result.awayGoals ? 'AWAY_WIN' : 'DRAW',
    home,
    away,
    keyEvents: result.events
      .filter((e) => KEY_EVENT_TYPES.has(e.type))
      .map((e) => ({ minute: e.minute, type: e.type, description: e.description, side: e.side })),
  };
}

function teamFacts(result: MatchResult, context: ReportContext, side: TeamSide): TeamFacts {
  const clubId = side === 'HOME' ? context.homeClubId : context.awayClubId;
  const club = context.clubs[clubId];
  const tactics = side === 'HOME' ? context.homeTactics : context.awayTactics;
  const stats: TeamStats = result.stats[side];
  const name = (id?: string) => (id ? context.playerNames[id] ?? 'Unknown' : 'Unknown');

  const scorers = result.events
    .filter((e) => e.type === 'GOAL' && e.side === side)
    .map((e) => ({
      playerId: e.playerId ?? '',
      name: name(e.playerId),
      minute: e.minute,
      assist: e.secondaryPlayerId ? name(e.secondaryPlayerId) : undefined,
      setPiece: Boolean((e.detail as { setPiece?: boolean }).setPiece),
      counterAttack: Boolean((e.detail as { counterAttack?: boolean }).counterAttack),
    }));

  const substitutions = result.events
    .filter((e) => e.type === 'SUBSTITUTION' && e.side === side)
    .map((e) => ({
      minute: e.minute,
      on: name(e.playerId),
      off: name(e.secondaryPlayerId),
      reason: String((e.detail as { reason?: string }).reason ?? 'tactical'),
    }));

  const bookings = result.events
    .filter((e) => (e.type === 'YELLOW_CARD' || e.type === 'RED_CARD') && e.side === side)
    .map((e) => ({
      minute: e.minute,
      name: name(e.playerId),
      type: e.type === 'RED_CARD' ? ('RED' as const) : ('YELLOW' as const),
    }));

  const injuries = result.events
    .filter((e) => e.type === 'INJURY' && e.side === side)
    .map((e) => ({ minute: e.minute, name: name(e.playerId) }));

  const topPerformers = result.performances
    .filter((p) => p.side === side)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 3)
    .map((p) => ({
      playerId: p.playerId,
      name: name(p.playerId),
      rating: p.rating,
      goals: p.goals,
      assists: p.assists,
      position: context.playerPositions[p.playerId] ?? p.position,
    }));

  return {
    clubId,
    name: club?.name ?? clubId,
    shortName: club?.shortName ?? clubId.slice(0, 3).toUpperCase(),
    side,
    goals: stats.goals,
    formation: tactics.formation,
    formationLabel: getFormation(tactics.formation).label,
    mentality: tactics.mentality,
    playingStyle: tactics.playingStyle,
    pressing: tactics.pressing,
    defensiveLine: tactics.defensiveLine,
    possession: stats.possession,
    shots: stats.shots,
    shotsOnTarget: stats.shotsOnTarget,
    expectedGoals: stats.expectedGoals,
    passes: stats.passes,
    passAccuracy: stats.passes > 0 ? Number(((stats.passesCompleted / stats.passes) * 100).toFixed(1)) : 0,
    fouls: stats.fouls,
    yellowCards: stats.yellowCards,
    redCards: stats.redCards,
    corners: stats.corners,
    offsides: stats.offsides,
    tackles: stats.tackles,
    interceptions: stats.interceptions,
    pressingActions: stats.pressingActions,
    pressingRate: stats.tacticalSummary.pressingRate,
    territory: stats.tacticalSummary.territory,
    directness: stats.tacticalSummary.directness,
    saves: stats.saves,
    bigChances: stats.bigChances,
    counterAttackGoals: stats.tacticalSummary.counterAttackGoals,
    setPieceGoals: stats.tacticalSummary.setPieceGoals,
    inMatchChanges: stats.tacticalSummary.formationChanges,
    scorers,
    substitutions,
    bookings,
    injuries,
    topPerformers,
  };
}

const STYLE_WORDS: Record<string, string> = {
  POSSESSION: 'possession football',
  BALANCED: 'a balanced approach',
  DIRECT: 'direct football',
  COUNTER_ATTACKING: 'a counter-attacking plan',
  HIGH_TEMPO: 'a high-tempo game',
  PATIENT_BUILD_UP: 'patient build-up',
};

const PRESS_WORDS: Record<string, string> = {
  LOW: 'sat off', MEDIUM: 'pressed selectively', HIGH: 'pressed high', INTENSE: 'pressed ferociously',
};

/**
 * A readable report assembled only from the facts above. No claim appears here
 * that is not backed by a number in `MatchFacts`.
 */
export function narrateMatch(facts: MatchFacts): string {
  const { home, away } = facts;
  const lines: string[] = [];

  const verb = facts.result === 'DRAW' ? 'drew with'
    : facts.result === 'HOME_WIN' ? 'beat' : 'lost to';
  lines.push(
    facts.result === 'DRAW'
      ? `${home.name} ${verb} ${away.name} ${facts.homeGoals}-${facts.awayGoals} at ${home.name}.`
      : `${home.name} ${verb} ${away.name} ${facts.homeGoals}-${facts.awayGoals}.`);

  const dominant = home.possession >= away.possession ? home : away;
  const other = dominant === home ? away : home;
  lines.push(
    `${dominant.shortName} had ${dominant.possession}% of the ball in a ${dominant.formationLabel}, ` +
    `playing ${STYLE_WORDS[dominant.playingStyle] ?? 'their usual game'} and ${PRESS_WORDS[dominant.pressing] ?? 'pressed'}; ` +
    `${other.shortName} lined up in a ${other.formationLabel} and ${PRESS_WORDS[other.pressing] ?? 'pressed'}.`);

  lines.push(
    `Shots finished ${home.shots}-${away.shots} (${home.shotsOnTarget}-${away.shotsOnTarget} on target) ` +
    `from ${home.expectedGoals} and ${away.expectedGoals} expected goals.`);

  for (const team of [home, away]) {
    if (team.scorers.length === 0) continue;
    const list = team.scorers
      .map((s) => {
        const how = s.setPiece ? ' from a set piece' : s.counterAttack ? ' on the counter' : '';
        const assist = s.assist ? `, set up by ${s.assist}` : '';
        return `${s.name} ${s.minute}'${how}${assist}`;
      })
      .join('; ');
    lines.push(`${team.shortName} scorers: ${list}.`);
  }

  const overperformer = [home, away].find((t) => t.goals - t.expectedGoals >= 1.2);
  if (overperformer) {
    lines.push(`${overperformer.shortName} scored ${overperformer.goals} from ${overperformer.expectedGoals} expected goals, a notably clinical afternoon.`);
  }
  const wasteful = [home, away].find((t) => t.expectedGoals - t.goals >= 1.2);
  if (wasteful) {
    lines.push(`${wasteful.shortName} created ${wasteful.expectedGoals} expected goals but took only ${wasteful.goals}, missing ${wasteful.bigChances} big chance${wasteful.bigChances === 1 ? '' : 's'} in total.`);
  }

  const reds = [...home.bookings, ...away.bookings].filter((b) => b.type === 'RED');
  if (reds.length > 0) {
    lines.push(`Red card${reds.length === 1 ? '' : 's'}: ${reds.map((r) => `${r.name} (${r.minute}')`).join(', ')}.`);
  }

  const presser = home.pressingRate >= away.pressingRate ? home : away;
  if (presser.pressingRate > 0) {
    lines.push(
      `${presser.shortName} made ${presser.pressingRate.toFixed(2)} defensive actions per opposition sequence, ` +
      `the more disruptive side out of possession.`);
  }

  const changes = [home, away].filter((t) => t.inMatchChanges > 0);
  if (changes.length > 0) {
    lines.push(changes.map((t) => `${t.shortName} adjusted their approach ${t.inMatchChanges} time${t.inMatchChanges === 1 ? '' : 's'} during the match`).join('; ') + '.');
  }

  const best = [...home.topPerformers, ...away.topPerformers].sort((a, b) => b.rating - a.rating)[0];
  if (best) {
    lines.push(`Player of the match: ${best.name} (${best.rating.toFixed(1)}).`);
  }

  return lines.join(' ');
}
