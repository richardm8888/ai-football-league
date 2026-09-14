import type { AttributeKey, PlayerAttributes, PlayerRole, Position } from '../types';
import { ROLE_DEFINITIONS } from './roles';

/**
 * How naturally a player covers a position, 0-1.
 *
 * This is deliberately separate from tactical familiarity: suitability is what a
 * player *is*, familiarity is what they have *practised*. A natural left-back
 * playing right-back is unsuitable but can still be drilled; a striker at
 * centre-back is unsuitable and drilling only partly helps.
 */
const ADJACENT: Record<Position, Position[]> = {
  GK: [],
  DC: ['DM', 'DL', 'DR'],
  DL: ['DC', 'ML', 'DM'],
  DR: ['DC', 'MR', 'DM'],
  DM: ['MC', 'DC'],
  MC: ['DM', 'AM', 'ML', 'MR'],
  ML: ['AML', 'DL', 'MC'],
  MR: ['AMR', 'DR', 'MC'],
  AM: ['MC', 'ST', 'AML', 'AMR'],
  AML: ['ML', 'AM', 'ST'],
  AMR: ['MR', 'AM', 'ST'],
  ST: ['AM', 'AML', 'AMR'],
};

const MIRROR: Partial<Record<Position, Position>> = {
  DL: 'DR', DR: 'DL', ML: 'MR', MR: 'ML', AML: 'AMR', AMR: 'AML',
};

export interface PositionalPlayer {
  primaryPosition: Position;
  secondaryPositions: Position[];
}

export function positionSuitability(player: PositionalPlayer, target: Position): number {
  if (player.primaryPosition === target) return 1;
  if (player.secondaryPositions.includes(target)) return 0.86;

  // A goalkeeper anywhere else, or anyone else in goal, is close to useless.
  if (target === 'GK' || player.primaryPosition === 'GK') return 0.08;

  if (MIRROR[target] === player.primaryPosition) return 0.72;
  if (ADJACENT[target].includes(player.primaryPosition)) return 0.6;
  if (player.secondaryPositions.some((p) => ADJACENT[target].includes(p))) return 0.52;
  return 0.32;
}

export type SuitabilityBand = 'NATURAL' | 'ACCOMPLISHED' | 'AWKWARD' | 'MAKESHIFT';

export function suitabilityBand(score: number): SuitabilityBand {
  if (score >= 0.95) return 'NATURAL';
  if (score >= 0.7) return 'ACCOMPLISHED';
  if (score >= 0.5) return 'AWKWARD';
  return 'MAKESHIFT';
}

/**
 * How well a player's attributes fit a role, 0-100. Weighted towards the role's
 * key attributes but never ignoring the rest, so a brilliant player remains
 * useful in a role that does not suit them.
 */
export function roleAptitude(attributes: PlayerAttributes, role: PlayerRole): number {
  const def = ROLE_DEFINITIONS[role];
  const keys = def.keyAttributes;
  const keyAvg = average(keys.map((k) => attributes[k]));
  const generalAvg = generalAbility(attributes, role === 'GOALKEEPER' || role === 'SWEEPER_KEEPER');
  return clamp(keyAvg * 0.7 + generalAvg * 0.3, 1, 100);
}

const OUTFIELD_GENERAL: AttributeKey[] = [
  'passing', 'firstTouch', 'decisions', 'composure', 'teamwork',
  'workRate', 'stamina', 'pace', 'strength', 'determination',
];
const KEEPER_GENERAL: AttributeKey[] = [
  'reflexes', 'handling', 'oneOnOnes', 'positioning', 'concentration', 'composure',
];

export function generalAbility(attributes: PlayerAttributes, isKeeper: boolean): number {
  const keys = isKeeper ? KEEPER_GENERAL : OUTFIELD_GENERAL;
  return average(keys.map((k) => attributes[k]));
}

/** A single headline number for squad lists. */
export function overallRating(attributes: PlayerAttributes, primaryPosition: Position): number {
  const isKeeper = primaryPosition === 'GK';
  if (isKeeper) return Math.round(generalAbility(attributes, true));
  const positional: Record<Exclude<Position, 'GK'>, AttributeKey[]> = {
    DC: ['marking', 'tackling', 'heading', 'positioning', 'strength'],
    DL: ['marking', 'tackling', 'crossing', 'pace', 'stamina'],
    DR: ['marking', 'tackling', 'crossing', 'pace', 'stamina'],
    DM: ['tackling', 'positioning', 'passing', 'anticipation', 'teamwork'],
    MC: ['passing', 'decisions', 'vision', 'stamina', 'firstTouch'],
    ML: ['crossing', 'dribbling', 'pace', 'stamina', 'passing'],
    MR: ['crossing', 'dribbling', 'pace', 'stamina', 'passing'],
    AM: ['vision', 'passing', 'firstTouch', 'dribbling', 'composure'],
    AML: ['dribbling', 'pace', 'crossing', 'acceleration', 'finishing'],
    AMR: ['dribbling', 'pace', 'crossing', 'acceleration', 'finishing'],
    ST: ['finishing', 'composure', 'anticipation', 'acceleration', 'heading'],
  };
  const keys = positional[primaryPosition as Exclude<Position, 'GK'>];
  return Math.round(clamp(average(keys.map((k) => attributes[k])) * 0.65 + generalAbility(attributes, false) * 0.35, 1, 100));
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
