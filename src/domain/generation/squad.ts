import { createRng, type Rng } from '@/engine/rng';
import { clamp, overallRating } from '../tactics/suitability';
import type { AttributeKey, Foot, PlayerAttributes, Position } from '../types';
import { ATTRIBUTE_KEYS } from '../types';
import { FIRST_NAMES, LAST_NAMES, PERSONALITIES } from './names';

/**
 * Fictional squad generation.
 *
 * Squads are generated from a club's reputation so a league is competitive but
 * not uniform, and from a seed so a league can be regenerated identically.
 */

export interface GeneratedPlayer {
  firstName: string;
  lastName: string;
  age: number;
  shirtNumber: number;
  primaryPosition: Position;
  secondaryPositions: Position[];
  preferredFoot: Foot;
  potential: number;
  personality: string;
  contractUntil: number;
  wageThousands: number;
  attributes: PlayerAttributes;
  /** Starting condition, so week one is not uniformly perfect. */
  fitness: number;
  morale: number;
  form: number;
  matchSharpness: number;
}

/** A squad of 20: enough for rotation, injuries and a full bench. */
const SQUAD_SHAPE: Array<{ position: Position; count: number }> = [
  { position: 'GK', count: 2 },
  { position: 'DC', count: 4 },
  { position: 'DL', count: 2 },
  { position: 'DR', count: 2 },
  { position: 'DM', count: 2 },
  { position: 'MC', count: 3 },
  { position: 'AML', count: 1 },
  { position: 'AMR', count: 1 },
  { position: 'AM', count: 1 },
  { position: 'ST', count: 3 },
];

const SECONDARY_OPTIONS: Record<Position, Position[]> = {
  GK: [],
  DC: ['DM', 'DL', 'DR'],
  DL: ['ML', 'DC', 'AML'],
  DR: ['MR', 'DC', 'AMR'],
  DM: ['MC', 'DC'],
  MC: ['DM', 'AM'],
  ML: ['AML', 'DL'],
  MR: ['AMR', 'DR'],
  AM: ['MC', 'ST', 'AML', 'AMR'],
  AML: ['ML', 'AM', 'ST'],
  AMR: ['MR', 'AM', 'ST'],
  ST: ['AM', 'AML', 'AMR'],
};

/** Attributes that matter most in each position get a boost. */
const POSITION_STRENGTHS: Record<Position, AttributeKey[]> = {
  GK: ['handling', 'reflexes', 'oneOnOnes', 'distribution', 'concentration', 'positioning'],
  DC: ['marking', 'tackling', 'heading', 'strength', 'positioning', 'concentration'],
  DL: ['marking', 'tackling', 'crossing', 'stamina', 'pace', 'workRate'],
  DR: ['marking', 'tackling', 'crossing', 'stamina', 'pace', 'workRate'],
  DM: ['tackling', 'positioning', 'anticipation', 'passing', 'teamwork', 'concentration'],
  MC: ['passing', 'vision', 'decisions', 'stamina', 'firstTouch', 'teamwork'],
  ML: ['crossing', 'dribbling', 'pace', 'stamina', 'agility'],
  MR: ['crossing', 'dribbling', 'pace', 'stamina', 'agility'],
  AM: ['vision', 'passing', 'firstTouch', 'composure', 'dribbling', 'longShots'],
  AML: ['dribbling', 'pace', 'acceleration', 'crossing', 'agility', 'balance'],
  AMR: ['dribbling', 'pace', 'acceleration', 'crossing', 'agility', 'balance'],
  ST: ['finishing', 'composure', 'anticipation', 'heading', 'acceleration', 'strength'],
};

const GK_ONLY: AttributeKey[] = ['handling', 'reflexes', 'oneOnOnes', 'distribution'];

function generateAttributes(rng: Rng, position: Position, quality: number): PlayerAttributes {
  const attributes = {} as PlayerAttributes;
  const strengths = new Set(POSITION_STRENGTHS[position]);
  for (const key of ATTRIBUTE_KEYS) {
    const isKeeperAttribute = GK_ONLY.includes(key);
    let mean = quality;
    if (position === 'GK') {
      // Keepers are good at keeping and unremarkable at everything else.
      mean = isKeeperAttribute ? quality + 6 : quality - 22;
      if (key === 'passing' || key === 'composure' || key === 'concentration') mean = quality - 8;
    } else if (isKeeperAttribute) {
      mean = 14;
    } else if (strengths.has(key)) {
      mean = quality + 8;
    } else {
      mean = quality - 6;
    }
    attributes[key] = Math.round(clamp(rng.normal(mean, 7), 1, 99));
  }
  return attributes;
}

export interface SquadGenerationOptions {
  seed: string;
  clubReputation: number;
  currentYear?: number;
}

export function generateSquad(options: SquadGenerationOptions): GeneratedPlayer[] {
  const rng = createRng(`squad:${options.seed}`);
  const year = options.currentYear ?? new Date().getFullYear();
  const players: GeneratedPlayer[] = [];
  const usedNumbers = new Set<number>();
  const usedNames = new Set<string>();

  const nextNumber = (preferred: number): number => {
    let n = preferred;
    while (usedNumbers.has(n) || n < 1 || n > 45) n = rng.int(2, 45);
    usedNumbers.add(n);
    return n;
  };

  let index = 0;
  for (const group of SQUAD_SHAPE) {
    for (let i = 0; i < group.count; i += 1) {
      // The first player in each group is the first choice; later ones are
      // squad players, which gives every club a real depth problem.
      const depthPenalty = i === 0 ? 0 : 5 + i * 3;
      const quality = clamp(
        rng.normal(options.clubReputation - depthPenalty, 5.5), 22, 92);

      let firstName = rng.choice(FIRST_NAMES);
      let lastName = rng.choice(LAST_NAMES);
      let guard = 0;
      while (usedNames.has(`${firstName} ${lastName}`) && guard < 40) {
        firstName = rng.choice(FIRST_NAMES);
        lastName = rng.choice(LAST_NAMES);
        guard += 1;
      }
      usedNames.add(`${firstName} ${lastName}`);

      const age = rng.int(17, 35);
      const secondaryPool = SECONDARY_OPTIONS[group.position];
      const secondaryPositions = secondaryPool.length > 0 && rng.chance(0.55)
        ? [rng.choice(secondaryPool)]
        : [];

      const foot: Foot = group.position === 'DL' || group.position === 'AML' || group.position === 'ML'
        ? (rng.chance(0.7) ? 'LEFT' : 'RIGHT')
        : rng.chance(0.78) ? 'RIGHT' : rng.chance(0.8) ? 'LEFT' : 'BOTH';

      const attributes = generateAttributes(rng, group.position, quality);
      const current = overallRating(attributes, group.position);
      // Young players have room to grow; older players are at their ceiling.
      const growth = age <= 21 ? rng.int(8, 22) : age <= 25 ? rng.int(3, 12) : rng.int(0, 4);

      players.push({
        firstName, lastName, age,
        shirtNumber: nextNumber(index + 1),
        primaryPosition: group.position,
        secondaryPositions,
        preferredFoot: foot,
        potential: Math.round(clamp(current + growth, current, 99)),
        personality: rng.choice(PERSONALITIES),
        contractUntil: year + rng.int(1, 4),
        wageThousands: Math.max(2, Math.round(current * rng.range(0.4, 0.9))),
        attributes,
        fitness: rng.int(88, 100),
        morale: rng.int(48, 78),
        form: rng.int(40, 62),
        matchSharpness: rng.int(45, 70),
      });
      index += 1;
    }
  }
  return players;
}
