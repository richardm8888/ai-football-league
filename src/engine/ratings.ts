import { getFormation } from '@/domain/tactics/formations';
import { ROLE_DEFINITIONS } from '@/domain/tactics/roles';
import { clamp, roleAptitude } from '@/domain/tactics/suitability';
import type { TacticalPlanInput } from '@/domain/schemas';
import type {
  BuildUp, DefensiveApproach, DefensiveLine, Mentality, PlayingStyle,
  PressingIntensity, RiskTolerance, Tempo, Width,
} from '@/domain/types';
import type { EnginePlayer, EngineTeam } from './types';

/**
 * Turning a squad and a tactical plan into the handful of numbers the match
 * simulation actually rolls against.
 *
 * Nothing here is random. Given the same team and tactics these numbers are
 * identical every time; all variance lives in the engine's dice.
 */

export type Channel =
  | 'defending' | 'pressing' | 'buildUp' | 'creation'
  | 'finishing' | 'width' | 'transition' | 'aerial';

export interface TeamRatings extends Record<Channel, number> {
  goalkeeping: number;
  /** Higher means more likely to concede fouls. */
  aggression: number;
  composure: number;
  setPieceDelivery: number;
  setPieceAttack: number;
  pace: number;
}

export function conditionFactor(p: EnginePlayer, currentFitness = p.fitness): number {
  const fitness = 0.62 + 0.38 * (clamp(currentFitness, 0, 100) / 100);
  const form = 0.94 + 0.12 * (clamp(p.form, 0, 100) / 100);
  const morale = 0.96 + 0.08 * (clamp(p.morale, 0, 100) / 100);
  const confidence = 0.96 + 0.08 * (clamp(p.confidence, 0, 100) / 100);
  const sharpness = 0.93 + 0.14 * (clamp(p.matchSharpness, 0, 100) / 100);
  return fitness * form * morale * confidence * sharpness;
}

/**
 * What a player is actually worth today in the job they have been given.
 * Ability, then how naturally they cover the position, then their condition,
 * then a small allowance for how well they know this particular role.
 */
export function effectiveAbility(p: EnginePlayer, currentFitness = p.fitness): number {
  const aptitude = roleAptitude(p.attributes, p.role);
  const suitability = 0.55 + 0.45 * clamp(p.suitability, 0, 1);
  const roleKnowledge = 0.94 + 0.06 * (clamp(p.roleFamiliarity * 0.55 + p.positionFamiliarity * 0.45, 0, 100) / 100);
  return aptitude * suitability * conditionFactor(p, currentFitness) * roleKnowledge;
}

type Band = 'GK' | 'DEFENCE' | 'MIDFIELD' | 'ATTACK';

const BAND_WEIGHTS: Record<Band, Record<Channel, number>> = {
  GK:       { defending: 0.20, pressing: 0.05, buildUp: 0.35, creation: 0.05, finishing: 0.00, width: 0.00, transition: 0.10, aerial: 0.25 },
  DEFENCE:  { defending: 1.00, pressing: 0.45, buildUp: 0.45, creation: 0.15, finishing: 0.05, width: 0.30, transition: 0.35, aerial: 0.80 },
  MIDFIELD: { defending: 0.60, pressing: 0.80, buildUp: 0.90, creation: 0.70, finishing: 0.25, width: 0.40, transition: 0.70, aerial: 0.40 },
  ATTACK:   { defending: 0.20, pressing: 0.60, buildUp: 0.35, creation: 0.80, finishing: 1.00, width: 0.60, transition: 0.80, aerial: 0.50 },
};

const CHANNELS: Channel[] = ['defending', 'pressing', 'buildUp', 'creation', 'finishing', 'width', 'transition', 'aerial'];

function bandOf(team: EngineTeam, player: EnginePlayer): Band {
  const slot = getFormation(team.tactics.formation).slots.find((s) => s.key === player.slot);
  return slot?.band ?? (player.position === 'GK' ? 'GK' : 'MIDFIELD');
}

/** Raw channel ratings from the eleven on the pitch, before tactics. */
export function baseRatings(
  team: EngineTeam,
  onPitch: EnginePlayer[],
  fitnessOf: (playerId: string) => number,
): TeamRatings {
  const totals: Record<Channel, number> = {
    defending: 0, pressing: 0, buildUp: 0, creation: 0,
    finishing: 0, width: 0, transition: 0, aerial: 0,
  };
  const weights: Record<Channel, number> = { ...totals };

  let goalkeeping = 40;
  let aggression = 0;
  let composure = 0;
  let paceTotal = 0;
  let outfieldCount = 0;
  let setPieceDelivery = 0;
  let setPieceAttack = 0;

  for (const player of onPitch) {
    const fitness = fitnessOf(player.id);
    const ability = effectiveAbility(player, fitness);
    const band = bandOf(team, player);

    if (band === 'GK') {
      goalkeeping = ability;
    } else {
      outfieldCount += 1;
      const cond = conditionFactor(player, fitness);
      aggression += (player.attributes.tackling * 0.5 + player.attributes.determination * 0.3
        + (100 - player.attributes.decisions) * 0.2) / 100;
      composure += player.attributes.composure * cond;
      paceTotal += (player.attributes.pace * 0.6 + player.attributes.acceleration * 0.4) * cond;
      setPieceDelivery = Math.max(setPieceDelivery, player.attributes.setPieces * cond);
      setPieceAttack += (player.attributes.heading * 0.6 + player.attributes.strength * 0.4) * cond;
    }

    const emphasis = ROLE_DEFINITIONS[player.role].emphasis;
    for (const channel of CHANNELS) {
      const weight = BAND_WEIGHTS[band][channel] * 0.55 + Math.max(0, emphasis[channel] ?? 0) * 0.9;
      if (weight <= 0) continue;
      totals[channel] += ability * weight;
      weights[channel] += weight;
    }
  }

  const ratings = {} as TeamRatings;
  for (const channel of CHANNELS) {
    ratings[channel] = weights[channel] > 0 ? totals[channel] / weights[channel] : 40;
  }
  const outfield = Math.max(1, outfieldCount);
  ratings.goalkeeping = goalkeeping;
  ratings.aggression = aggression / outfield;
  ratings.composure = composure / outfield;
  ratings.pace = paceTotal / outfield;
  ratings.setPieceDelivery = setPieceDelivery;
  ratings.setPieceAttack = setPieceAttack / outfield;
  return ratings;
}

// ---------------------------------------------------------------------------
// Tactical profile
// ---------------------------------------------------------------------------

/** How the instructions translate into behaviour the engine can roll against. */
export interface TacticalProfile {
  possessionWeight: number;
  directness: number;
  sequenceRate: number;
  buildUpSuccess: number;
  chanceRate: number;
  chanceQuality: number;
  defensiveSolidity: number;
  pressAggression: number;
  foulRate: number;
  offsideForRate: number;
  vulnerabilityInBehind: number;
  counterThreat: number;
  counterVulnerability: number;
  fatigueRate: number;
  setPieceThreat: number;
  crossingShare: number;
  cardRisk: number;
}

const MENTALITY: Record<Mentality, Partial<TacticalProfile>> = {
  VERY_DEFENSIVE:  { possessionWeight: 0.82, chanceRate: 0.74, chanceQuality: 0.92, defensiveSolidity: 1.14, counterThreat: 1.05, counterVulnerability: 0.88 },
  DEFENSIVE:       { possessionWeight: 0.91, chanceRate: 0.87, chanceQuality: 0.96, defensiveSolidity: 1.07, counterThreat: 1.03, counterVulnerability: 0.94 },
  BALANCED:        {},
  POSITIVE:        { possessionWeight: 1.08, chanceRate: 1.12, chanceQuality: 1.03, defensiveSolidity: 0.95, counterVulnerability: 1.08 },
  ATTACKING:       { possessionWeight: 1.16, chanceRate: 1.25, chanceQuality: 1.06, defensiveSolidity: 0.88, counterVulnerability: 1.2 },
};

const STYLE: Record<PlayingStyle, Partial<TacticalProfile>> = {
  POSSESSION:        { possessionWeight: 1.22, sequenceRate: 0.9, directness: 0.3, buildUpSuccess: 1.08, chanceQuality: 1.04, chanceRate: 0.96, counterVulnerability: 1.06 },
  BALANCED:          {},
  DIRECT:            { possessionWeight: 0.86, sequenceRate: 1.1, directness: 0.8, buildUpSuccess: 0.95, chanceRate: 1.08, chanceQuality: 0.93, setPieceThreat: 1.05 },
  COUNTER_ATTACKING: { possessionWeight: 0.8, sequenceRate: 1.04, directness: 0.72, chanceRate: 0.88, chanceQuality: 1.14, counterThreat: 1.45, defensiveSolidity: 1.05 },
  HIGH_TEMPO:        { sequenceRate: 1.16, directness: 0.62, buildUpSuccess: 0.96, chanceRate: 1.12, chanceQuality: 0.95, fatigueRate: 1.18 },
  PATIENT_BUILD_UP:  { possessionWeight: 1.16, sequenceRate: 0.84, directness: 0.22, buildUpSuccess: 1.1, chanceRate: 0.9, chanceQuality: 1.1, fatigueRate: 0.92 },
};

const PRESSING: Record<PressingIntensity, Partial<TacticalProfile>> = {
  LOW:     { pressAggression: 0.55, fatigueRate: 0.88, foulRate: 0.85, counterThreat: 0.92 },
  MEDIUM:  { pressAggression: 0.85, fatigueRate: 0.98 },
  HIGH:    { pressAggression: 1.2, fatigueRate: 1.16, foulRate: 1.15, counterThreat: 1.1, counterVulnerability: 1.08 },
  INTENSE: { pressAggression: 1.45, fatigueRate: 1.34, foulRate: 1.32, cardRisk: 1.25, counterThreat: 1.2, counterVulnerability: 1.2 },
};

const LINE: Record<DefensiveLine, Partial<TacticalProfile>> = {
  DEEP:      { defensiveSolidity: 1.1, vulnerabilityInBehind: 0.7, offsideForRate: 0.5, counterThreat: 1.08, chanceRate: 0.94 },
  STANDARD:  {},
  HIGH:      { defensiveSolidity: 0.97, vulnerabilityInBehind: 1.25, offsideForRate: 1.35, chanceRate: 1.06, pressAggression: 1.08 },
  VERY_HIGH: { defensiveSolidity: 0.92, vulnerabilityInBehind: 1.55, offsideForRate: 1.7, chanceRate: 1.12, pressAggression: 1.15 },
};

const BUILDUP: Record<BuildUp, Partial<TacticalProfile>> = {
  SHORT_PASSING:     { buildUpSuccess: 1.06, directness: 0.25, possessionWeight: 1.1, counterVulnerability: 1.1 },
  MIXED:             {},
  DIRECT:            { buildUpSuccess: 0.94, directness: 0.78, possessionWeight: 0.9, setPieceThreat: 1.04 },
  LONG_DISTRIBUTION: { buildUpSuccess: 0.86, directness: 0.95, possessionWeight: 0.8, setPieceThreat: 1.08, chanceQuality: 0.9 },
};

const WIDTH_PROFILE: Record<Width, Partial<TacticalProfile>> = {
  NARROW:   { crossingShare: 0.55, chanceQuality: 1.05, chanceRate: 0.96 },
  BALANCED: {},
  WIDE:     { crossingShare: 1.35, chanceRate: 1.06, chanceQuality: 0.96, setPieceThreat: 1.06 },
};

const APPROACH: Record<DefensiveApproach, Partial<TacticalProfile>> = {
  ZONAL:               { defensiveSolidity: 1.02, counterVulnerability: 0.98 },
  MAN_ORIENTED:        { defensiveSolidity: 1.0, foulRate: 1.1, vulnerabilityInBehind: 1.08, pressAggression: 1.05 },
  AGGRESSIVE_PRESSING: { pressAggression: 1.25, foulRate: 1.2, fatigueRate: 1.15, defensiveSolidity: 0.97, counterVulnerability: 1.12 },
  COMPACT_BLOCK:       { defensiveSolidity: 1.1, chanceRate: 0.95, counterVulnerability: 0.92 },
  MID_BLOCK:           { defensiveSolidity: 1.05, counterThreat: 1.06 },
  LOW_BLOCK:           { defensiveSolidity: 1.16, vulnerabilityInBehind: 0.72, possessionWeight: 0.84, chanceRate: 0.82, counterThreat: 1.18 },
};

const TEMPO_PROFILE: Record<Tempo, Partial<TacticalProfile>> = {
  VERY_SLOW: { sequenceRate: 0.82, buildUpSuccess: 1.06, chanceQuality: 1.06, fatigueRate: 0.9 },
  SLOW:      { sequenceRate: 0.91, buildUpSuccess: 1.03, chanceQuality: 1.03 },
  NORMAL:    {},
  FAST:      { sequenceRate: 1.1, buildUpSuccess: 0.96, chanceRate: 1.05, fatigueRate: 1.1 },
  VERY_FAST: { sequenceRate: 1.2, buildUpSuccess: 0.9, chanceRate: 1.1, chanceQuality: 0.95, fatigueRate: 1.2 },
};

const RISK: Record<RiskTolerance, Partial<TacticalProfile>> = {
  CAUTIOUS: { buildUpSuccess: 1.07, chanceQuality: 0.92, chanceRate: 0.9, counterVulnerability: 0.9 },
  MEASURED: { buildUpSuccess: 1.03, chanceQuality: 0.97, chanceRate: 0.96 },
  BALANCED: {},
  BOLD:     { buildUpSuccess: 0.95, chanceQuality: 1.07, chanceRate: 1.07, counterVulnerability: 1.1 },
  RECKLESS: { buildUpSuccess: 0.87, chanceQuality: 1.13, chanceRate: 1.14, counterVulnerability: 1.25, cardRisk: 1.1 },
};

function neutralProfile(): TacticalProfile {
  return {
    possessionWeight: 1, directness: 0.5, sequenceRate: 1, buildUpSuccess: 1,
    chanceRate: 1, chanceQuality: 1, defensiveSolidity: 1, pressAggression: 1,
    foulRate: 1, offsideForRate: 1, vulnerabilityInBehind: 1, counterThreat: 1,
    counterVulnerability: 1, fatigueRate: 1, setPieceThreat: 1, crossingShare: 1,
    cardRisk: 1,
  };
}

const MULTIPLICATIVE = new Set<keyof TacticalProfile>([
  'possessionWeight', 'sequenceRate', 'buildUpSuccess', 'chanceRate', 'chanceQuality',
  'defensiveSolidity', 'pressAggression', 'foulRate', 'offsideForRate',
  'vulnerabilityInBehind', 'counterThreat', 'counterVulnerability', 'fatigueRate',
  'setPieceThreat', 'crossingShare', 'cardRisk',
]);

function apply(profile: TacticalProfile, patch: Partial<TacticalProfile>): void {
  for (const [key, value] of Object.entries(patch) as Array<[keyof TacticalProfile, number]>) {
    if (MULTIPLICATIVE.has(key)) profile[key] *= value;
    else profile[key] = value; // directness is set, not compounded
  }
}

export function tacticalProfile(tactics: TacticalPlanInput): TacticalProfile {
  const profile = neutralProfile();
  apply(profile, MENTALITY[tactics.mentality]);
  apply(profile, STYLE[tactics.playingStyle]);
  apply(profile, PRESSING[tactics.pressing]);
  apply(profile, LINE[tactics.defensiveLine]);
  apply(profile, BUILDUP[tactics.buildUp]);
  apply(profile, WIDTH_PROFILE[tactics.width]);
  apply(profile, APPROACH[tactics.defensiveApproach]);
  apply(profile, TEMPO_PROFILE[tactics.tempo]);
  apply(profile, RISK[tactics.riskTolerance]);

  if (tactics.counterPress) {
    profile.pressAggression *= 1.12;
    profile.fatigueRate *= 1.08;
    profile.counterVulnerability *= 0.9;
    profile.counterThreat *= 1.08;
  }
  if (tactics.counterAttack) {
    profile.counterThreat *= 1.3;
    profile.chanceQuality *= 1.03;
  }
  if (tactics.offsideTrap) {
    profile.offsideForRate *= 1.9;
    profile.vulnerabilityInBehind *= 1.12;
  }
  // Full-back freedom trades width in attack for exposure on the flanks.
  const freedom = (tactics.fullBackFreedom - 50) / 50;
  profile.crossingShare *= 1 + freedom * 0.25;
  profile.chanceRate *= 1 + freedom * 0.06;
  profile.counterVulnerability *= 1 + freedom * 0.12;
  profile.fatigueRate *= 1 + Math.max(0, freedom) * 0.06;

  const shape = getFormation(tactics.formation).traits;
  profile.crossingShare *= 0.8 + (shape.naturalWidth / 100) * 0.45;
  profile.possessionWeight *= 0.9 + (shape.centralDensity / 100) * 0.2;
  profile.defensiveSolidity *= 0.94 + (shape.defenders / 5) * 0.1;
  profile.chanceRate *= 0.92 + (shape.attackers / 3) * 0.12;

  return profile;
}

/**
 * Familiarity is folded in here, and only here, so each dimension lands on the
 * one part of the game it is supposed to affect.
 */
export function applyExecution(ratings: TeamRatings, team: EngineTeam, profile: TacticalProfile): void {
  const x = team.execution;
  ratings.pressing *= x.pressingCoordination;
  ratings.buildUp *= x.buildUpSecurity;
  ratings.defending *= x.defensiveCompactness;
  ratings.transition *= x.transitionReliability;
  ratings.setPieceDelivery *= x.setPieceExecution;
  ratings.setPieceAttack *= x.setPieceExecution;
  // Positioning quality is broad but shallow: it touches everything a little.
  const positional = 1 + (x.positionalQuality - 1) * 0.5;
  ratings.creation *= positional;
  ratings.defending *= positional;
  ratings.width *= positional;

  // Badly drilled sides also make more errors and mistime more challenges.
  profile.buildUpSuccess *= x.buildUpSecurity;
  profile.counterVulnerability *= 2 - x.defensiveCompactness;
  profile.counterThreat *= x.transitionReliability;
  profile.foulRate *= 2 - x.pressingCoordination;
  profile.setPieceThreat *= x.setPieceExecution;
}

export const HOME_ADVANTAGE = 1.075;
