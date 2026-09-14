import type { Rng } from '@/engine/rng';
import type { PlayerPerformance } from '@/engine/types';
import { INTENSITY_MULTIPLIER } from '../familiarity';
import type { TrainingPlanInput } from '../schemas';
import { clamp } from '../tactics/suitability';
import type { AttributeKey, InjurySeverity, PlayerAttributes, TrainingFocus } from '../types';

/**
 * What a week does to a squad.
 *
 * Training has to cost something, or every manager picks maximum intensity every
 * week. Fitness, fatigue, sharpness, development, injury risk and tactical work
 * are traded against each other here, and the results feed straight back into
 * the match engine's condition factors.
 */

export interface WeeklyPlayerState {
  playerId: string;
  age: number;
  potential: number;
  fitness: number;
  fatigue: number;
  morale: number;
  form: number;
  confidence: number;
  matchSharpness: number;
  injury: InjurySeverity;
  injuryDescription: string | null;
  injuryWeeksLeft: number;
  suspensionMatches: number;
  yellowCardsSeason: number;
  redCardsSeason: number;
  attributes: PlayerAttributes;
  /** Key attributes the player's individual session targets, if any. */
  individualRoleAttributes?: AttributeKey[];
}

export interface TrainingOutcome {
  states: WeeklyPlayerState[];
  notes: string[];
  newInjuries: Array<{ playerId: string; severity: InjurySeverity; description: string; weeks: number }>;
  developments: Array<{ playerId: string; attribute: AttributeKey; from: number; to: number }>;
}

/** How hard each focus is on the legs, and what it does for sharpness. */
const FOCUS_LOAD: Record<TrainingFocus, { load: number; sharpness: number; fitness: number }> = {
  RECOVERY:               { load: -1.6, sharpness: -1.5, fitness: 5.5 },
  FITNESS:                { load: 1.6, sharpness: 0.5, fitness: 3.2 },
  POSSESSION:             { load: 0.8, sharpness: 1.4, fitness: 0.6 },
  PRESSING:               { load: 1.5, sharpness: 1.8, fitness: 0.4 },
  DEFENSIVE_ORGANISATION: { load: 0.7, sharpness: 1.2, fitness: 0.6 },
  ATTACKING_PATTERNS:     { load: 0.9, sharpness: 1.6, fitness: 0.5 },
  TRANSITION_PLAY:        { load: 1.3, sharpness: 1.7, fitness: 0.4 },
  SET_PIECES:             { load: 0.4, sharpness: 0.8, fitness: 0.8 },
  FORMATION_FAMILIARITY:  { load: 0.6, sharpness: 1.0, fitness: 0.7 },
  INDIVIDUAL_ROLES:       { load: 0.8, sharpness: 1.1, fitness: 0.6 },
  MATCH_PREPARATION:      { load: 0.5, sharpness: 2.4, fitness: 1.0 },
};

const INJURY_LABELS: Array<{ severity: InjurySeverity; description: string; weeks: [number, number] }> = [
  { severity: 'KNOCK', description: 'Dead leg', weeks: [1, 1] },
  { severity: 'KNOCK', description: 'Bruised ribs', weeks: [1, 1] },
  { severity: 'MINOR', description: 'Tight hamstring', weeks: [1, 2] },
  { severity: 'MINOR', description: 'Ankle sprain', weeks: [1, 3] },
  { severity: 'MODERATE', description: 'Hamstring strain', weeks: [3, 5] },
  { severity: 'MODERATE', description: 'Groin strain', weeks: [2, 5] },
  { severity: 'SERIOUS', description: 'Knee ligament damage', weeks: [6, 12] },
];

export function applyTrainingWeek(
  states: WeeklyPlayerState[], plan: TrainingPlanInput, rng: Rng,
): TrainingOutcome {
  const intensity = INTENSITY_MULTIPLIER[plan.intensity];
  const primary = FOCUS_LOAD[plan.primaryFocus];
  const secondary = FOCUS_LOAD[plan.secondaryFocus];
  const load = (primary.load * 0.65 + secondary.load * 0.35) * intensity;
  const sharpnessGain = (primary.sharpness * 0.65 + secondary.sharpness * 0.35) * intensity;
  const fitnessGain = (primary.fitness * 0.65 + secondary.fitness * 0.35);

  const individual = new Map(plan.individualFocus.map((i) => [i.playerId, i]));
  const notes: string[] = [];
  const newInjuries: TrainingOutcome['newInjuries'] = [];
  const developments: TrainingOutcome['developments'] = [];

  const out = states.map((state) => {
    const next: WeeklyPlayerState = { ...state, attributes: { ...state.attributes } };

    // Injured players recover instead of training.
    if (next.injury !== 'NONE' && next.injuryWeeksLeft > 0) {
      next.injuryWeeksLeft -= 1;
      next.fitness = clamp(next.fitness + 4, 0, 92);
      next.matchSharpness = clamp(next.matchSharpness - 3, 0, 100);
      next.fatigue = clamp(next.fatigue - 6, 0, 100);
      if (next.injuryWeeksLeft <= 0) {
        next.injury = 'NONE';
        next.injuryDescription = null;
        notes.push(`${next.playerId} is back in full training.`);
      }
      return next;
    }

    if (next.suspensionMatches > 0) next.suspensionMatches -= 1;

    // Older legs recover more slowly and tire faster.
    const ageFactor = next.age >= 31 ? 1.25 : next.age <= 22 ? 0.85 : 1;
    next.fatigue = clamp(next.fatigue + load * 3 * ageFactor - 4, 0, 100);
    next.fitness = clamp(
      next.fitness + fitnessGain + (8 - next.fatigue * 0.12) - Math.max(0, load) * 1.2, 0, 100);
    next.matchSharpness = clamp(next.matchSharpness + sharpnessGain - 1, 0, 100);

    // Injury risk: intensity, accumulated fatigue and age all push it up.
    const risk = clamp(
      0.006 + Math.max(0, load) * 0.008 + (next.fatigue / 100) * 0.035
      + (next.age >= 31 ? 0.008 : 0) - (next.attributes.strength - 55) / 6000,
      0.002, 0.14);
    if (rng.chance(risk)) {
      const severityRoll = rng.next();
      const pool = severityRoll > 0.94
        ? INJURY_LABELS.filter((i) => i.severity === 'SERIOUS')
        : severityRoll > 0.72
          ? INJURY_LABELS.filter((i) => i.severity === 'MODERATE')
          : severityRoll > 0.4
            ? INJURY_LABELS.filter((i) => i.severity === 'MINOR')
            : INJURY_LABELS.filter((i) => i.severity === 'KNOCK');
      const injury = rng.choice(pool);
      const weeks = rng.int(injury.weeks[0], injury.weeks[1]);
      next.injury = injury.severity;
      next.injuryDescription = injury.description;
      next.injuryWeeksLeft = weeks;
      next.morale = clamp(next.morale - 6, 0, 100);
      newInjuries.push({ playerId: next.playerId, severity: injury.severity, description: injury.description, weeks });
      notes.push(`${next.playerId} picked up a ${injury.description.toLowerCase()} in training (${weeks} week${weeks === 1 ? '' : 's'}).`);
      return next;
    }

    // Development. Young players with headroom improve slowly; individual work
    // concentrates that improvement on the attributes their role needs.
    const current = averageAttributes(next.attributes);
    const headroom = next.potential - current;
    if (headroom > 1) {
      const focusEntry = individual.get(next.playerId);
      const developmentChance = clamp(
        (next.age <= 21 ? 0.34 : next.age <= 25 ? 0.2 : next.age <= 29 ? 0.09 : 0.03)
        * intensity * (focusEntry ? 1.9 : 1) * clamp(headroom / 12, 0.2, 1.4),
        0, 0.85);
      if (rng.chance(developmentChance)) {
        const candidates = focusEntry && next.individualRoleAttributes?.length
          ? next.individualRoleAttributes
          : (Object.keys(next.attributes) as AttributeKey[]);
        const attribute = rng.choice(candidates);
        const from = next.attributes[attribute];
        if (from < 99) {
          next.attributes[attribute] = from + 1;
          developments.push({ playerId: next.playerId, attribute, from, to: from + 1 });
        }
      }
    } else if (next.age >= 32 && rng.chance(0.1)) {
      // Decline in the physical attributes first.
      const attribute = rng.choice<AttributeKey>(['pace', 'acceleration', 'stamina', 'agility']);
      const from = next.attributes[attribute];
      if (from > 20) {
        next.attributes[attribute] = from - 1;
        developments.push({ playerId: next.playerId, attribute, from, to: from - 1 });
      }
    }

    return next;
  });

  if (plan.intensity === 'VERY_HIGH') {
    notes.push('A punishing week on the training ground. The squad is sharper but heavy-legged.');
  }
  if (plan.primaryFocus === 'RECOVERY' || plan.secondaryFocus === 'RECOVERY') {
    notes.push('Recovery work has taken the load off tired legs.');
  }
  return { states: out, notes, newInjuries, developments };
}

// ---------------------------------------------------------------------------
// Match aftermath
// ---------------------------------------------------------------------------

export type MatchOutcome = 'WIN' | 'DRAW' | 'LOSS';

export interface AftermathInput {
  state: WeeklyPlayerState;
  performance?: PlayerPerformance;
  outcome: MatchOutcome;
  /** Goal difference from this club's point of view. */
  goalDifference: number;
  rng: Rng;
}

export function applyMatchAftermath(input: AftermathInput): WeeklyPlayerState {
  const { state, performance, outcome, goalDifference, rng } = input;
  const next: WeeklyPlayerState = { ...state, attributes: { ...state.attributes } };

  const resultMorale = outcome === 'WIN' ? 6 : outcome === 'DRAW' ? 1 : -5;
  const marginMorale = clamp(goalDifference, -3, 3) * 1.2;

  if (!performance || performance.minutesPlayed === 0) {
    // Unused players rest but lose their edge.
    next.fitness = clamp(next.fitness + 6, 0, 100);
    next.fatigue = clamp(next.fatigue - 8, 0, 100);
    next.matchSharpness = clamp(next.matchSharpness - 3.5, 0, 100);
    next.morale = clamp(next.morale + resultMorale * 0.4 - 1, 0, 100);
    next.form = clamp(next.form - 1.5, 0, 100);
    return next;
  }

  const minutes = performance.minutesPlayed;
  next.fitness = clamp(performance.endFitness, 0, 100);
  next.fatigue = clamp(next.fatigue + minutes * 0.28, 0, 100);
  next.matchSharpness = clamp(next.matchSharpness + minutes * 0.09, 0, 100);

  // Form follows the performance rating, smoothed so one match is not decisive.
  const ratingDelta = (performance.rating - 6.6) * 9;
  next.form = clamp(next.form * 0.7 + (55 + ratingDelta) * 0.3, 0, 100);
  next.confidence = clamp(
    next.confidence + (performance.goals * 5) + (performance.assists * 3)
    + (performance.rating >= 7.5 ? 4 : performance.rating <= 5.5 ? -4 : 0), 0, 100);
  next.morale = clamp(next.morale + resultMorale + marginMorale * 0.4
    + (performance.rating >= 7.5 ? 2 : 0) - (performance.redCard ? 5 : 0), 0, 100);

  if (performance.yellowCard) {
    next.yellowCardsSeason += 1;
    // Suspension for accumulated bookings.
    if (next.yellowCardsSeason % 5 === 0) next.suspensionMatches += 1;
  }
  if (performance.redCard) {
    next.redCardsSeason += 1;
    next.suspensionMatches += 2;
  }
  if (performance.injured && next.injury === 'NONE') {
    const roll = rng.next();
    const pool = roll > 0.9
      ? INJURY_LABELS.filter((i) => i.severity === 'MODERATE')
      : roll > 0.55
        ? INJURY_LABELS.filter((i) => i.severity === 'MINOR')
        : INJURY_LABELS.filter((i) => i.severity === 'KNOCK');
    const injury = rng.choice(pool);
    next.injury = injury.severity;
    next.injuryDescription = injury.description;
    next.injuryWeeksLeft = rng.int(injury.weeks[0], injury.weeks[1]);
  }
  return next;
}

function averageAttributes(attributes: PlayerAttributes): number {
  const values = Object.values(attributes);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Squad morale is the average of the players', nudged by recent results. */
export function clubMorale(states: WeeklyPlayerState[], recentForm: string): number {
  if (states.length === 0) return 50;
  const base = states.reduce((acc, s) => acc + s.morale, 0) / states.length;
  const results = recentForm.slice(-5).split('');
  const bonus = results.reduce((acc, r) => acc + (r === 'W' ? 2 : r === 'D' ? 0 : -2), 0);
  return Math.round(clamp(base + bonus, 1, 100));
}
