import { clamp } from '@/domain/tactics/suitability';
import type { MatchStateInstruction } from '@/domain/schemas';
import type { TeamSide } from '@/domain/types';
import { createRng, type Rng } from './rng';
import {
  applyExecution, baseRatings, conditionFactor, HOME_ADVANTAGE,
  tacticalProfile, type TacticalProfile, type TeamRatings,
} from './ratings';
import type {
  EngineEvent, EnginePlayer, EngineTeam, MatchInput, MatchResult,
  PlayerPerformance, TeamStats,
} from './types';

/**
 * The match engine.
 *
 * It is a conventional, event-based simulation: the match is a chain of
 * possession sequences, each resolved through build-up, pressing, chance
 * creation and finishing, with fouls, set pieces, injuries, substitutions and
 * in-match tactical changes layered on the minute clock.
 *
 * It is the only thing in this application allowed to decide a result. It takes
 * no dependency on the AI layer, performs no I/O, and draws every random number
 * from a seeded generator, so a match can always be replayed exactly.
 */
export const ENGINE_VERSION = '1.0.0';

/** Roughly the number of possession sequences in a normal match. */
const BASE_SEQUENCES = 208;

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Compare two ratings on a scale where a 10-point gap is already substantial. */
function edge(attacker: number, defender: number, scale = 14): number {
  return logistic((attacker - defender) / scale);
}

interface TeamState {
  team: EngineTeam;
  side: TeamSide;
  onPitch: EnginePlayer[];
  bench: EnginePlayer[];
  fitness: Map<string, number>;
  minutes: Map<string, number>;
  ratings: TeamRatings;
  profile: TacticalProfile;
  stats: TeamStats;
  performances: Map<string, PlayerPerformance>;
  substitutionsUsed: number;
  bookings: Set<string>;
  sentOff: Set<string>;
  firedInstructions: Set<string>;
  sequencesWithBall: number;
  finalThirdEntries: number;
  defensiveActions: number;
  counterAttackGoals: number;
  setPieceGoals: number;
  formationChanges: number;
  longPasses: number;
  totalPassSequences: number;
}

function emptyStats(team: EngineTeam): TeamStats {
  return {
    possession: 0, shots: 0, shotsOnTarget: 0, expectedGoals: 0, passes: 0,
    passesCompleted: 0, fouls: 0, yellowCards: 0, redCards: 0, corners: 0,
    offsides: 0, tackles: 0, interceptions: 0, pressingActions: 0, saves: 0,
    bigChances: 0, goals: 0,
    tacticalSummary: {
      formation: team.tactics.formation,
      mentality: team.tactics.mentality,
      playingStyle: team.tactics.playingStyle,
      pressing: team.tactics.pressing,
      defensiveLine: team.tactics.defensiveLine,
      territory: 0, pressingRate: 0, counterAttackGoals: 0, setPieceGoals: 0,
      directness: 0, formationChanges: 0,
    },
  };
}

function newPerformance(player: EnginePlayer, team: EngineTeam): PlayerPerformance {
  return {
    playerId: player.id, clubId: team.clubId, side: team.side,
    minutesPlayed: 0, position: player.position, role: player.role,
    rating: 6, goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, expectedGoals: 0,
    passes: 0, passesCompleted: 0, keyPasses: 0, tackles: 0, interceptions: 0,
    saves: 0, fouls: 0, yellowCard: false, redCard: false, injured: false,
    endFitness: player.fitness,
  };
}

function createState(team: EngineTeam): TeamState {
  const fitness = new Map<string, number>();
  const minutes = new Map<string, number>();
  const performances = new Map<string, PlayerPerformance>();
  for (const p of [...team.starters, ...team.bench]) {
    fitness.set(p.id, p.fitness);
    minutes.set(p.id, 0);
  }
  for (const p of team.starters) performances.set(p.id, newPerformance(p, team));

  const state: TeamState = {
    team, side: team.side,
    onPitch: [...team.starters],
    bench: [...team.bench],
    fitness, minutes,
    ratings: {} as TeamRatings,
    profile: tacticalProfile(team.tactics),
    stats: emptyStats(team),
    performances,
    substitutionsUsed: 0,
    bookings: new Set(), sentOff: new Set(), firedInstructions: new Set(),
    sequencesWithBall: 0, finalThirdEntries: 0, defensiveActions: 0,
    counterAttackGoals: 0, setPieceGoals: 0, formationChanges: 0,
    longPasses: 0, totalPassSequences: 0,
  };
  refreshRatings(state);
  return state;
}

function refreshRatings(state: TeamState): void {
  const ratings = baseRatings(state.team, state.onPitch, (id) => state.fitness.get(id) ?? 60);
  // A side reduced to ten men loses shape everywhere, most of all in attack.
  const missing = 11 - state.onPitch.length;
  if (missing > 0) {
    const defensive = 1 - missing * 0.07;
    const attacking = 1 - missing * 0.13;
    ratings.defending *= defensive;
    ratings.pressing *= attacking;
    ratings.creation *= attacking;
    ratings.finishing *= attacking;
    ratings.buildUp *= defensive;
    ratings.width *= attacking;
    ratings.transition *= attacking;
  }
  const profile = tacticalProfile(state.team.tactics);
  applyExecution(ratings, state.team, profile);
  if (state.side === 'HOME') {
    // Playing at home lifts the attack most and steadies the defence a little.
    ratings.creation *= HOME_ADVANTAGE;
    ratings.finishing *= HOME_ADVANTAGE;
    ratings.buildUp *= HOME_ADVANTAGE;
    ratings.defending *= 1 + (HOME_ADVANTAGE - 1) * 0.5;
    ratings.pressing *= 1 + (HOME_ADVANTAGE - 1) * 0.5;
  }
  // Squad morale nudges everything a little.
  const moraleFactor = 0.97 + (clamp(state.team.morale, 0, 100) / 100) * 0.06;
  for (const key of ['defending', 'pressing', 'buildUp', 'creation', 'finishing', 'transition'] as const) {
    ratings[key] *= moraleFactor;
  }
  const carried = state.profile as AdjustableProfile | undefined;
  state.ratings = ratings;
  // Keep any in-match adjustments that have already fired.
  state.profile = carried?.adjusted?.length
    ? applyCarriedAdjustments(profile, carried)
    : profile;
}

/** Marker so refreshed profiles keep in-match instruction effects. */
interface AdjustableProfile extends TacticalProfile {
  adjusted?: Array<Partial<TacticalProfile>>;
}

function applyCarriedAdjustments(fresh: TacticalProfile, previous: AdjustableProfile): TacticalProfile {
  const out = fresh as AdjustableProfile;
  out.adjusted = previous.adjusted;
  for (const patch of previous.adjusted ?? []) {
    for (const [key, value] of Object.entries(patch) as Array<[keyof TacticalProfile, number]>) {
      out[key] = (out[key] as number) * value;
    }
  }
  return out;
}

const ADJUSTMENTS: Record<string, Partial<TacticalProfile>> = {
  MORE_ATTACKING: { possessionWeight: 1.1, chanceRate: 1.18, defensiveSolidity: 0.9, counterVulnerability: 1.15 },
  MORE_DEFENSIVE: { possessionWeight: 0.9, chanceRate: 0.82, defensiveSolidity: 1.12, counterVulnerability: 0.9 },
  PRESS_HIGHER: { pressAggression: 1.2, fatigueRate: 1.12, vulnerabilityInBehind: 1.15 },
  DROP_DEEPER: { defensiveSolidity: 1.1, vulnerabilityInBehind: 0.82, chanceRate: 0.92, counterThreat: 1.1 },
  SLOW_TEMPO: { sequenceRate: 0.9, buildUpSuccess: 1.04, chanceRate: 0.94 },
  RAISE_TEMPO: { sequenceRate: 1.12, buildUpSuccess: 0.95, chanceRate: 1.08, fatigueRate: 1.1 },
  GO_DIRECT: { directness: 0.85, buildUpSuccess: 0.94, chanceRate: 1.06, chanceQuality: 0.94, setPieceThreat: 1.08 },
  KEEP_THE_BALL: { possessionWeight: 1.18, sequenceRate: 0.9, chanceRate: 0.88, buildUpSuccess: 1.06 },
  WASTE_TIME: { sequenceRate: 0.82, possessionWeight: 1.08, chanceRate: 0.8, buildUpSuccess: 1.03 },
};

function instructionMatches(
  instruction: MatchStateInstruction, minute: number, goalDiff: number, redFor: number, redAgainst: number,
): boolean {
  if (minute < instruction.fromMinute) return false;
  switch (instruction.trigger) {
    case 'LEADING': return goalDiff > 0;
    case 'LEADING_BY_TWO': return goalDiff >= 2;
    case 'DRAWING': return goalDiff === 0;
    case 'TRAILING': return goalDiff < 0;
    case 'TRAILING_BY_TWO': return goalDiff <= -2;
    case 'AFTER_60': return minute >= 60;
    case 'AFTER_75': return minute >= 75;
    case 'RED_CARD_FOR': return redFor > 0;
    case 'RED_CARD_AGAINST': return redAgainst > 0;
    default: return false;
  }
}

export function simulateMatch(input: MatchInput): MatchResult {
  const rng = createRng(`${input.seed}|${ENGINE_VERSION}`);
  const home = createState(input.home);
  const away = createState(input.away);
  const events: EngineEvent[] = [];
  let sequence = 0;

  const push = (
    minute: number, type: EngineEvent['type'], description: string,
    extra: Partial<EngineEvent> = {},
  ) => {
    sequence += 1;
    events.push({
      sequence, minute, type, description,
      detail: extra.detail ?? {},
      side: extra.side,
      playerId: extra.playerId,
      secondaryPlayerId: extra.secondaryPlayerId,
    });
  };

  push(0, 'KICK_OFF', `${home.team.name} kick off against ${away.team.name}.`, {
    detail: { homeFormation: home.team.tactics.formation, awayFormation: away.team.tactics.formation },
  });

  const sequenceRate = (home.profile.sequenceRate + away.profile.sequenceRate) / 2;
  const totalSequences = Math.round(BASE_SEQUENCES * sequenceRate * rng.range(0.94, 1.06));
  const stoppage = rng.int(2, 6);
  const finalMinute = 90 + stoppage;

  let minute = 1;
  let halfTimeDone = false;

  const scoreOf = (state: TeamState) => state.stats.goals;
  const goalDifferenceFor = (state: TeamState, other: TeamState) => scoreOf(state) - scoreOf(other);

  const perf = (state: TeamState, player: EnginePlayer): PlayerPerformance => {
    let p = state.performances.get(player.id);
    if (!p) {
      p = newPerformance(player, state.team);
      state.performances.set(player.id, p);
    }
    return p;
  };

  // --- per-minute housekeeping ---------------------------------------------

  const tickMinute = (currentMinute: number) => {
    for (const state of [home, away]) {
      const other = state === home ? away : home;
      // Fatigue.
      for (const player of state.onPitch) {
        const current = state.fitness.get(player.id) ?? 100;
        const stamina = player.attributes.stamina;
        const workRate = player.attributes.workRate;
        const drain = (0.42 + (100 - stamina) / 320 + (workRate / 100) * 0.1)
          * state.profile.fatigueRate;
        state.fitness.set(player.id, clamp(current - drain, 15, 100));
        state.minutes.set(player.id, (state.minutes.get(player.id) ?? 0) + 1);
        perf(state, player).minutesPlayed += 1;
      }
      // Match-state instructions.
      const goalDiff = goalDifferenceFor(state, other);
      for (const instruction of state.team.tactics.matchStateInstructions) {
        const key = `${instruction.trigger}:${instruction.adjustment}`;
        if (state.firedInstructions.has(key)) continue;
        if (!instructionMatches(instruction, currentMinute, goalDiff, state.stats.redCards, other.stats.redCards)) continue;
        state.firedInstructions.add(key);
        const patch = ADJUSTMENTS[instruction.adjustment];
        if (!patch) continue;
        const profile = state.profile as AdjustableProfile;
        profile.adjusted = [...(profile.adjusted ?? []), patch];
        for (const [k, v] of Object.entries(patch) as Array<[keyof TacticalProfile, number]>) {
          profile[k] = (profile[k] as number) * v;
        }
        state.formationChanges += 1;
        push(currentMinute, 'TACTICAL_CHANGE',
          `${state.team.name} react to the game state: ${instruction.adjustment.replace(/_/g, ' ').toLowerCase()}.`,
          { side: state.side, detail: { trigger: instruction.trigger, adjustment: instruction.adjustment } });
      }
      // Planned substitutions.
      applySubstitutions(state, other, currentMinute, push, perf, rng);
    }
    if (currentMinute % 5 === 0) {
      refreshRatings(home);
      refreshRatings(away);
    }
  };

  // --- sequence resolution --------------------------------------------------

  for (let i = 0; i < totalSequences; i += 1) {
    const newMinute = Math.min(90, 1 + Math.floor((i / totalSequences) * 90));
    while (minute < newMinute) {
      minute += 1;
      tickMinute(minute);
      if (!halfTimeDone && minute === 46) {
        halfTimeDone = true;
        push(45, 'HALF_TIME',
          `Half time: ${home.team.shortName} ${home.stats.goals} - ${away.stats.goals} ${away.team.shortName}.`,
          { detail: { homeGoals: home.stats.goals, awayGoals: away.stats.goals } });
        // A breather at the interval.
        for (const state of [home, away]) {
          for (const player of state.onPitch) {
            const current = state.fitness.get(player.id) ?? 100;
            state.fitness.set(player.id, clamp(current + 3.5, 15, 100));
          }
        }
      }
    }

    const homeWeight = home.profile.possessionWeight * (0.65 + home.ratings.buildUp / 150);
    const awayWeight = away.profile.possessionWeight * (0.65 + away.ratings.buildUp / 150);
    const attacking = rng.next() < homeWeight / (homeWeight + awayWeight) ? home : away;
    const defending = attacking === home ? away : home;
    resolveSequence(attacking, defending, minute, rng, push, perf, false);
  }

  // Stoppage time: a handful of extra sequences with the same weights.
  for (let m = 91; m <= finalMinute; m += 1) {
    minute = m;
    tickMinute(m);
    const extra = rng.int(1, 3);
    for (let k = 0; k < extra; k += 1) {
      const homeWeight = home.profile.possessionWeight * (0.65 + home.ratings.buildUp / 150);
      const awayWeight = away.profile.possessionWeight * (0.65 + away.ratings.buildUp / 150);
      const attacking = rng.next() < homeWeight / (homeWeight + awayWeight) ? home : away;
      resolveSequence(attacking, attacking === home ? away : home, m, rng, push, perf, false);
    }
  }

  push(finalMinute, 'FULL_TIME',
    `Full time: ${home.team.name} ${home.stats.goals} - ${away.stats.goals} ${away.team.name}.`,
    { detail: { homeGoals: home.stats.goals, awayGoals: away.stats.goals, stoppage } });

  finalise(home, away);
  finalise(away, home);

  const performances = [...home.performances.values(), ...away.performances.values()]
    .filter((p) => p.minutesPlayed > 0);

  return {
    engineVersion: ENGINE_VERSION,
    seed: input.seed,
    fixtureId: input.fixtureId,
    homeGoals: home.stats.goals,
    awayGoals: away.stats.goals,
    events,
    stats: { HOME: home.stats, AWAY: away.stats },
    performances,
  };
}

// ---------------------------------------------------------------------------
// Sequence
// ---------------------------------------------------------------------------

type PushFn = (minute: number, type: EngineEvent['type'], description: string, extra?: Partial<EngineEvent>) => void;
type PerfFn = (state: TeamState, player: EnginePlayer) => PlayerPerformance;

function weightedPlayer(state: TeamState, rng: Rng, weight: (p: EnginePlayer) => number): EnginePlayer {
  return rng.pick(state.onPitch.filter((p) => p.position !== 'GK'), weight);
}

function resolveSequence(
  attacking: TeamState, defending: TeamState, minute: number,
  rng: Rng, push: PushFn, perf: PerfFn, isCounter: boolean,
): void {
  attacking.sequencesWithBall += 1;
  attacking.totalPassSequences += 1;

  const attackProfile = attacking.profile;
  const defenceProfile = defending.profile;

  // 1. Build-up: how many passes and how many stick.
  const directness = clamp(attackProfile.directness, 0, 1);
  const passCount = Math.max(1, Math.round(rng.normal(6 - directness * 3.5, 1.8)));
  const pressure = clamp(
    (defending.ratings.pressing * defenceProfile.pressAggression - attacking.ratings.buildUp) / 100, -0.5, 0.6);
  const accuracy = clamp(
    0.80 + (attacking.ratings.buildUp - 55) / 260 + (attackProfile.buildUpSuccess - 1) * 0.35
    - pressure * 0.14 - directness * 0.08,
    0.45, 0.96);
  let completed = 0;
  for (let i = 0; i < passCount; i += 1) if (rng.chance(accuracy)) completed += 1;
  attacking.stats.passes += passCount;
  attacking.stats.passesCompleted += completed;
  if (directness > 0.6) attacking.longPasses += 1;

  const passer = weightedPlayer(attacking, rng, (p) => p.attributes.passing + p.attributes.vision * 0.5);
  const passerPerf = perf(attacking, passer);
  passerPerf.passes += passCount;
  passerPerf.passesCompleted += completed;

  // 2. Does the press win it back?
  const pressChance = clamp(0.2 * defenceProfile.pressAggression
    * edge(defending.ratings.pressing, attacking.ratings.buildUp, 18) * 2, 0.04, 0.6);
  if (rng.chance(pressChance)) {
    defending.stats.pressingActions += 1;
    defending.defensiveActions += 1;
  }

  const retention = clamp(
    0.56 + (attacking.ratings.buildUp - defending.ratings.pressing * defenceProfile.pressAggression) / 300
    + (attackProfile.buildUpSuccess - 1) * 0.4,
    0.25, 0.85);

  if (!rng.chance(retention)) {
    // Turnover.
    const winner = weightedPlayer(defending, rng,
      (p) => p.attributes.tackling + p.attributes.anticipation + p.attributes.workRate * 0.5);
    const winnerPerf = perf(defending, winner);
    const byTackle = rng.chance(0.45);
    if (byTackle) {
      defending.stats.tackles += 1;
      winnerPerf.tackles += 1;
      push(minute, 'TACKLE', `${winner.name} wins the ball back for ${defending.team.shortName}.`,
        { side: defending.side, playerId: winner.id, secondaryPlayerId: passer.id });
    } else {
      defending.stats.interceptions += 1;
      winnerPerf.interceptions += 1;
      push(minute, 'INTERCEPTION', `${winner.name} reads the pass and intercepts.`,
        { side: defending.side, playerId: winner.id, secondaryPlayerId: passer.id });
    }
    defending.defensiveActions += 1;

    // Transition: the turnover can spring an immediate counter.
    if (!isCounter) {
      const counterChance = clamp(
        0.1 * defenceProfile.counterThreat * attackProfile.counterVulnerability
        * (0.6 + defending.ratings.transition / 160), 0.02, 0.4);
      if (rng.chance(counterChance)) {
        push(minute, 'POSSESSION_SEQUENCE',
          `${defending.team.shortName} break at pace.`,
          { side: defending.side, detail: { counterAttack: true } });
        resolveSequence(defending, attacking, minute, rng, push, perf, true);
      }
    }
    maybeFoul(defending, attacking, minute, rng, push, perf);
    return;
  }

  // 3. Into the final third?
  const entryChance = clamp(
    0.46 * attackProfile.chanceRate
    * (0.65 + edge(attacking.ratings.creation + attacking.ratings.width * 0.3,
      defending.ratings.defending * defenceProfile.defensiveSolidity, 20)),
    0.1, 0.9);
  if (!rng.chance(entryChance)) {
    maybeFoul(defending, attacking, minute, rng, push, perf);
    return;
  }
  attacking.finalThirdEntries += 1;

  // Offside against a high line, or a corner from a blocked attack.
  if (rng.chance(clamp(0.055 * defenceProfile.offsideForRate * (0.7 + directness * 0.6), 0.01, 0.18))) {
    const caught = weightedPlayer(attacking, rng, (p) => (p.role.includes('FORWARD') || p.position === 'ST' ? 3 : 1));
    attacking.stats.offsides += 1;
    push(minute, 'OFFSIDE', `${caught.name} is flagged offside.`,
      { side: attacking.side, playerId: caught.id });
    return;
  }

  if (rng.chance(0.14)) {
    attacking.stats.corners += 1;
    resolveSetPiece(attacking, defending, minute, rng, push, perf, 'CORNER');
    return;
  }

  // 4. Chance created?
  const creationEdge = edge(
    attacking.ratings.creation * (isCounter ? attackProfile.counterThreat : 1),
    defending.ratings.defending * defenceProfile.defensiveSolidity, 16);
  const chanceProbability = clamp(
    0.29 * attackProfile.chanceRate * (0.55 + creationEdge) * (isCounter ? 1.5 : 1),
    0.06, 0.95);
  if (!rng.chance(chanceProbability)) {
    maybeFoul(defending, attacking, minute, rng, push, perf);
    return;
  }

  const creator = weightedPlayer(attacking, rng,
    (p) => p.attributes.vision + p.attributes.passing + p.attributes.crossing * attackProfile.crossingShare * 0.5);
  const shooter = weightedPlayer(attacking, rng, (p) => {
    const positional = p.position === 'ST' ? 3.2 : p.position === 'AM' || p.position === 'AML' || p.position === 'AMR' ? 2.2 : p.position === 'MC' ? 1.1 : 0.4;
    return positional * (p.attributes.finishing + p.attributes.anticipation * 0.4);
  });
  resolveShot(attacking, defending, shooter, creator, minute, rng, push, perf, isCounter, false);
}

function chanceQuality(
  attacking: TeamState, defending: TeamState, shooter: EnginePlayer, rng: Rng,
  isCounter: boolean, isSetPiece: boolean,
): number {
  const base = rng.range(0.02, 0.178);
  const quality = base
    * attacking.profile.chanceQuality
    * (1 + (shooter.attributes.positioning + shooter.attributes.anticipation - 100) / 260)
    * (isCounter ? 1.45 : 1)
    * (isSetPiece ? 1.15 : 1)
    * (2 - clamp(defending.profile.defensiveSolidity, 0.7, 1.3));
  return clamp(quality, 0.01, 0.82);
}

function resolveShot(
  attacking: TeamState, defending: TeamState, shooter: EnginePlayer, creator: EnginePlayer,
  minute: number, rng: Rng, push: PushFn, perf: PerfFn, isCounter: boolean, isSetPiece: boolean,
): void {
  const quality = chanceQuality(attacking, defending, shooter, rng, isCounter, isSetPiece);
  const big = quality > 0.25;
  attacking.stats.shots += 1;
  attacking.stats.expectedGoals += quality;
  if (big) attacking.stats.bigChances += 1;

  const shooterPerf = perf(attacking, shooter);
  shooterPerf.shots += 1;
  shooterPerf.expectedGoals += quality;
  if (creator.id !== shooter.id) perf(attacking, creator).keyPasses += 1;

  const keeper = defending.onPitch.find((p) => p.position === 'GK');
  const keeperRating = keeper ? defending.ratings.goalkeeping : 30;

  const finishing = (shooter.attributes.finishing * 0.6 + shooter.attributes.composure * 0.4);
  const finishingMultiplier = 0.68 + (finishing / 100) * 0.45;
  const keeperMultiplier = clamp(1.05 - ((keeperRating - 50) / 50) * 0.35, 0.62, 1.3);
  const goalProbability = clamp(quality * finishingMultiplier * keeperMultiplier, 0.005, 0.9);

  if (rng.chance(goalProbability)) {
    attacking.stats.goals += 1;
    attacking.stats.shotsOnTarget += 1;
    shooterPerf.goals += 1;
    shooterPerf.shotsOnTarget += 1;
    if (creator.id !== shooter.id) perf(attacking, creator).assists += 1;
    if (isCounter) attacking.counterAttackGoals += 1;
    if (isSetPiece) attacking.setPieceGoals += 1;
    push(minute, 'GOAL',
      `GOAL! ${shooter.name} scores for ${attacking.team.shortName}${creator.id !== shooter.id ? `, set up by ${creator.name}` : ''}.`,
      {
        side: attacking.side, playerId: shooter.id,
        secondaryPlayerId: creator.id !== shooter.id ? creator.id : undefined,
        detail: { expectedGoals: Number(quality.toFixed(3)), counterAttack: isCounter, setPiece: isSetPiece, bigChance: big },
      });
    return;
  }

  const onTarget = clamp(0.27 + quality * 0.45 + (finishing - 55) / 320, 0.1, 0.72);
  if (rng.chance(onTarget)) {
    attacking.stats.shotsOnTarget += 1;
    shooterPerf.shotsOnTarget += 1;
    defending.stats.saves += 1;
    if (keeper) perf(defending, keeper).saves += 1;
    push(minute, 'SAVE',
      `${keeper ? keeper.name : 'The goalkeeper'} saves from ${shooter.name}.`,
      {
        side: defending.side, playerId: keeper?.id, secondaryPlayerId: shooter.id,
        detail: { expectedGoals: Number(quality.toFixed(3)), bigChance: big },
      });
  } else {
    push(minute, 'SHOT', `${shooter.name} shoots wide for ${attacking.team.shortName}.`,
      {
        side: attacking.side, playerId: shooter.id,
        detail: { expectedGoals: Number(quality.toFixed(3)), onTarget: false, bigChance: big },
      });
  }
}

function resolveSetPiece(
  attacking: TeamState, defending: TeamState, minute: number,
  rng: Rng, push: PushFn, perf: PerfFn, kind: 'CORNER' | 'FREE_KICK',
): void {
  push(minute, 'CORNER', `Corner for ${attacking.team.shortName}.`, { side: attacking.side, detail: { kind } });
  const delivery = attacking.ratings.setPieceDelivery * attacking.profile.setPieceThreat;
  const attack = attacking.ratings.setPieceAttack;
  const defence = defending.ratings.aerial * defending.profile.defensiveSolidity;
  const probability = clamp(0.26 * edge(delivery * 0.5 + attack * 0.5, defence, 18) * 2, 0.06, 0.6);
  if (!rng.chance(probability)) return;
  const target = rng.pick(attacking.onPitch.filter((p) => p.position !== 'GK'),
    (p) => p.attributes.heading * 1.5 + p.attributes.strength);
  const taker = rng.pick(attacking.onPitch.filter((p) => p.position !== 'GK' && p.id !== target.id),
    (p) => p.attributes.setPieces * 2 + p.attributes.crossing);
  resolveShot(attacking, defending, target, taker, minute, rng, push, perf, false, true);
}

function maybeFoul(
  fouling: TeamState, fouled: TeamState, minute: number,
  rng: Rng, push: PushFn, perf: PerfFn,
): void {
  const probability = clamp(0.125 * fouling.profile.foulRate * (0.7 + fouling.ratings.aggression * 0.6), 0.01, 0.36);
  if (!rng.chance(probability)) return;

  const offender = weightedPlayer(fouling, rng,
    (p) => p.attributes.tackling * 0.5 + p.attributes.determination * 0.5 + (100 - p.attributes.decisions) * 0.4);
  const victim = weightedPlayer(fouled, rng, (p) => p.attributes.dribbling + p.attributes.pace * 0.5);
  fouling.stats.fouls += 1;
  perf(fouling, offender).fouls += 1;
  push(minute, 'FOUL', `${offender.name} fouls ${victim.name}.`,
    { side: fouling.side, playerId: offender.id, secondaryPlayerId: victim.id });

  // Already-booked players are refereed, and play, more cautiously.
  const alreadyBooked = fouling.bookings.has(offender.id);
  const cardProbability = clamp(0.138 * fouling.profile.cardRisk
    * (alreadyBooked ? 0.4 : 1)
    * (1 + (100 - offender.attributes.decisions) / 220), 0.02, 0.42);
  if (rng.chance(cardProbability)) {
    if (fouling.bookings.has(offender.id)) {
      sendOff(fouling, offender, minute, push, perf, 'second yellow card');
    } else if (rng.chance(0.012)) {
      sendOff(fouling, offender, minute, push, perf, 'a straight red card');
    } else {
      fouling.bookings.add(offender.id);
      fouling.stats.yellowCards += 1;
      perf(fouling, offender).yellowCard = true;
      push(minute, 'YELLOW_CARD', `${offender.name} is booked.`,
        { side: fouling.side, playerId: offender.id });
    }
  }

  // A foul in a dangerous area is a chance in itself.
  if (rng.chance(0.16)) {
    resolveSetPiece(fouled, fouling, minute, rng, push, perf, 'FREE_KICK');
  }
  maybeInjury(fouled, victim, minute, rng, push, perf);
}

function sendOff(
  state: TeamState, player: EnginePlayer, minute: number,
  push: PushFn, perf: PerfFn, reason: string,
): void {
  state.sentOff.add(player.id);
  state.stats.redCards += 1;
  perf(state, player).redCard = true;
  state.onPitch = state.onPitch.filter((p) => p.id !== player.id);
  push(minute, 'RED_CARD', `${player.name} is sent off for ${reason}.`,
    { side: state.side, playerId: player.id, detail: { reason } });
  refreshRatings(state);
}

function maybeInjury(
  state: TeamState, player: EnginePlayer, minute: number,
  rng: Rng, push: PushFn, perf: PerfFn,
): void {
  const fitness = state.fitness.get(player.id) ?? 100;
  const probability = clamp(0.006 + (100 - fitness) / 4000 + (100 - player.attributes.strength) / 9000, 0, 0.06);
  if (!rng.chance(probability)) return;
  perf(state, player).injured = true;
  push(minute, 'INJURY', `${player.name} goes down injured.`,
    { side: state.side, playerId: player.id, detail: { fitnessAtInjury: Math.round(fitness) } });
  // Force the player off if anyone is available.
  const replacement = state.bench.find((b) => !state.onPitch.includes(b));
  if (replacement && state.substitutionsUsed < 5) {
    performSubstitution(state, player, replacement, minute, push, perf, 'injury');
  } else {
    state.onPitch = state.onPitch.filter((p) => p.id !== player.id);
    refreshRatings(state);
  }
}

function performSubstitution(
  state: TeamState, off: EnginePlayer, on: EnginePlayer, minute: number,
  push: PushFn, perf: PerfFn, reason: string,
): void {
  state.onPitch = state.onPitch.map((p) => (p.id === off.id ? on : p));
  state.bench = state.bench.filter((b) => b.id !== on.id);
  state.substitutionsUsed += 1;
  if (!state.performances.has(on.id)) state.performances.set(on.id, newPerformance(on, state.team));
  push(minute, 'SUBSTITUTION',
    `${state.team.shortName} substitution: ${on.name} replaces ${off.name}.`,
    { side: state.side, playerId: on.id, secondaryPlayerId: off.id, detail: { reason } });
  refreshRatings(state);
}

function applySubstitutions(
  state: TeamState, opponent: TeamState, minute: number,
  push: PushFn, perf: PerfFn, rng: Rng,
): void {
  if (state.substitutionsUsed >= 5) return;
  const goalDiff = state.stats.goals - opponent.stats.goals;

  for (const sub of state.team.tactics.substitutionPlan) {
    if (state.substitutionsUsed >= 5) return;
    if (sub.minute !== minute) continue;
    const off = state.onPitch.find((p) => p.id === sub.outPlayerId);
    const on = state.bench.find((p) => p.id === sub.inPlayerId);
    if (!off || !on) continue;
    const fitness = state.fitness.get(off.id) ?? 100;
    const conditionMet =
      sub.condition === 'ALWAYS' ||
      (sub.condition === 'IF_LEADING' && goalDiff > 0) ||
      (sub.condition === 'IF_DRAWING' && goalDiff === 0) ||
      (sub.condition === 'IF_TRAILING' && goalDiff < 0) ||
      (sub.condition === 'IF_TIRED' && fitness < 62) ||
      (sub.condition === 'IF_BOOKED' && state.bookings.has(off.id));
    if (!conditionMet) continue;
    if (sub.role) on.role = sub.role;
    performSubstitution(state, off, on, minute, push, perf, `planned (${sub.condition.toLowerCase()})`);
  }

  // Safety net: pull off anyone who is running on empty late on.
  if (minute >= 60 && state.substitutionsUsed < 3 && state.bench.length > 0) {
    const exhausted = state.onPitch
      .filter((p) => p.position !== 'GK' && (state.fitness.get(p.id) ?? 100) < 48)
      .sort((a, b) => (state.fitness.get(a.id) ?? 100) - (state.fitness.get(b.id) ?? 100))[0];
    if (exhausted && rng.chance(0.5)) {
      const replacement = state.bench
        .filter((b) => b.position !== 'GK')
        .sort((a, b) => b.attributes.stamina - a.attributes.stamina)[0];
      if (replacement) {
        performSubstitution(state, exhausted, replacement, minute, push, perf, 'tiring');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Finalising
// ---------------------------------------------------------------------------

function finalise(state: TeamState, opponent: TeamState): void {
  const totalSequences = state.sequencesWithBall + opponent.sequencesWithBall;
  state.stats.possession = totalSequences > 0
    ? Number(((state.sequencesWithBall / totalSequences) * 100).toFixed(1))
    : 50;
  state.stats.expectedGoals = Number(state.stats.expectedGoals.toFixed(2));

  state.stats.tacticalSummary = {
    ...state.stats.tacticalSummary,
    territory: state.sequencesWithBall > 0
      ? Number((state.finalThirdEntries / state.sequencesWithBall).toFixed(3)) : 0,
    pressingRate: opponent.sequencesWithBall > 0
      ? Number((state.defensiveActions / opponent.sequencesWithBall).toFixed(3)) : 0,
    counterAttackGoals: state.counterAttackGoals,
    setPieceGoals: state.setPieceGoals,
    directness: state.totalPassSequences > 0
      ? Number((state.longPasses / state.totalPassSequences).toFixed(3)) : 0,
    formationChanges: state.formationChanges,
  };

  const goalsConceded = opponent.stats.goals;
  for (const [playerId, performance] of state.performances) {
    performance.endFitness = Math.round(state.fitness.get(playerId) ?? performance.endFitness);
    performance.rating = ratePlayer(performance, state, goalsConceded);
  }
}

/** Player ratings are derived from what the player actually did, nothing else. */
function ratePlayer(p: PlayerPerformance, state: TeamState, goalsConceded: number): number {
  if (p.minutesPlayed === 0) return 6;
  const share = clamp(p.minutesPlayed / 90, 0.2, 1.05);
  let rating = 6.0;
  rating += p.goals * 1.15;
  rating += p.assists * 0.75;
  rating += p.keyPasses * 0.14;
  rating += p.shotsOnTarget * 0.1;
  rating += p.tackles * 0.11;
  rating += p.interceptions * 0.1;
  rating += p.saves * 0.17;
  rating -= p.fouls * 0.07;
  if (p.yellowCard) rating -= 0.25;
  if (p.redCard) rating -= 1.3;
  if (p.expectedGoals > 0.6 && p.goals === 0) rating -= 0.4;

  const passAccuracy = p.passes > 0 ? p.passesCompleted / p.passes : 0.8;
  rating += (passAccuracy - 0.79) * 2.2;

  const isDefensive = p.position === 'GK' || p.position === 'DC' || p.position === 'DL' || p.position === 'DR';
  if (isDefensive) {
    rating += goalsConceded === 0 ? 0.55 : -0.22 * goalsConceded;
  }
  const goalDiff = state.stats.goals - goalsConceded;
  rating += clamp(goalDiff, -3, 3) * 0.1;

  return Number(clamp(6 + (rating - 6) * share, 1, 10).toFixed(1));
}
