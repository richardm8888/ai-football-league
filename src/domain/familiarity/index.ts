import { formationDistance, getFormation } from '../tactics/formations';
import { ROLE_DEFINITIONS } from '../tactics/roles';
import { clamp } from '../tactics/suitability';
import type { TacticalPlanInput, TrainingPlanInput } from '../schemas';
import type {
  BuildUp, DefensiveApproach, FamiliarityDimension, Formation, PlayerRole,
  PlayingStyle, Position, PressingIntensity, TrainingIntensity,
} from '../types';

/**
 * Tactical familiarity.
 *
 * Two rules shape this whole module:
 *
 *  1. Familiarity is never a single cohesion number. It is tracked per dimension
 *     and each dimension drives one specific part of the match engine, so a team
 *     that has not practised pressing presses badly and does everything else
 *     normally.
 *
 *  2. Familiarity buys reliability, not dominance. Every execution modifier is
 *     clamped to a narrow band, so a perfectly drilled weak side still loses to
 *     a much stronger one more often than not.
 */

/** Values are 0-100. Keys are the specific setting that was practised. */
export interface ClubFamiliarity {
  FORMATION: Partial<Record<Formation, number>>;
  PLAYING_STYLE: Partial<Record<PlayingStyle, number>>;
  PRESSING: Partial<Record<PressingIntensity, number>>;
  DEFENSIVE_ORGANISATION: Partial<Record<DefensiveApproach, number>>;
  BUILD_UP: Partial<Record<BuildUp, number>>;
  TRANSITION: number;
  SET_PIECES: number;
  OVERALL_STABILITY: number;
}

export interface PlayerFamiliarityMap {
  [playerId: string]: {
    roles: Partial<Record<PlayerRole, number>>;
    positions: Partial<Record<Position, number>>;
  };
}

export const FAMILIARITY_FLOOR = 18;
export const FAMILIARITY_CEILING = 99;
/** What a newly formed squad knows about a system it has never trained. */
export const UNTRAINED_FAMILIARITY = 30;

export function emptyClubFamiliarity(): ClubFamiliarity {
  return {
    FORMATION: {}, PLAYING_STYLE: {}, PRESSING: {},
    DEFENSIVE_ORGANISATION: {}, BUILD_UP: {},
    TRANSITION: UNTRAINED_FAMILIARITY,
    SET_PIECES: UNTRAINED_FAMILIARITY,
    OVERALL_STABILITY: UNTRAINED_FAMILIARITY,
  };
}

function read<K extends string>(map: Partial<Record<K, number>>, key: K): number {
  return map[key] ?? UNTRAINED_FAMILIARITY;
}

export function familiarityFor(f: ClubFamiliarity, plan: TacticalPlanInput) {
  return {
    formation: read(f.FORMATION, plan.formation),
    playingStyle: read(f.PLAYING_STYLE, plan.playingStyle),
    pressing: read(f.PRESSING, plan.pressing),
    defensiveOrganisation: read(f.DEFENSIVE_ORGANISATION, plan.defensiveApproach),
    buildUp: read(f.BUILD_UP, plan.buildUp),
    transition: f.TRANSITION,
    setPieces: f.SET_PIECES,
    overallStability: f.OVERALL_STABILITY,
  };
}

// ---------------------------------------------------------------------------
// Change analysis
// ---------------------------------------------------------------------------

export type ChangeMagnitude = 'NONE' | 'MINOR' | 'MODERATE' | 'MAJOR';

export interface TacticalChange {
  area: string;
  label: string;
  from: string;
  to: string;
  /** 0-1: how disruptive this single change is. */
  cost: number;
  /** Which parts of the team's execution this change actually degrades. */
  affects: ExecutionChannel[];
}

export type ExecutionChannel =
  | 'pressingCoordination'
  | 'buildUpSecurity'
  | 'defensiveCompactness'
  | 'positionalQuality'
  | 'transitionReliability'
  | 'setPieceExecution';

export interface TacticalChangeAnalysis {
  magnitude: ChangeMagnitude;
  /** 0-1 aggregate disruption. */
  score: number;
  changes: TacticalChange[];
  /** Manager-facing warnings, strongest first. */
  warnings: string[];
  /** Per-channel disruption, 0-1, applied on top of raw familiarity. */
  disruption: Record<ExecutionChannel, number>;
  /** True when several structural areas moved in the same week. */
  simultaneousStructuralChange: boolean;
}

const STRUCTURAL_AREAS = new Set(['formation', 'playingStyle', 'defensiveApproach']);

const emptyDisruption = (): Record<ExecutionChannel, number> => ({
  pressingCoordination: 0,
  buildUpSecurity: 0,
  defensiveCompactness: 0,
  positionalQuality: 0,
  transitionReliability: 0,
  setPieceExecution: 0,
});

/**
 * Compare what the manager has asked for against what the squad has practised
 * and, where known, what it played last time out.
 */
export function analyseTacticalChange(
  next: TacticalPlanInput,
  familiarity: ClubFamiliarity,
  previous: TacticalPlanInput | null,
): TacticalChangeAnalysis {
  const changes: TacticalChange[] = [];
  const f = familiarityFor(familiarity, next);
  /** Unfamiliarity of the chosen setting, 0-1. */
  const unfamiliar = (value: number) => clamp((70 - value) / 70, 0, 1);

  const add = (
    area: string, label: string, from: string, to: string,
    baseCost: number, affects: ExecutionChannel[],
  ) => {
    if (baseCost <= 0.001) return;
    changes.push({ area, label, from, to, cost: clamp(baseCost, 0, 1), affects });
  };

  // Formation. The cost is how far the shape moved, discounted by how well the
  // squad already knows the new shape — which is what makes a gradual switch,
  // trained in advance, far cheaper than a last-minute one.
  const formationMoved = previous && previous.formation !== next.formation;
  const shapeDistance = previous ? formationDistance(previous.formation, next.formation) : 0;
  add('formation', 'Formation',
    previous ? getFormation(previous.formation).label : '—',
    getFormation(next.formation).label,
    (formationMoved ? 0.45 + shapeDistance * 0.65 : 0) * unfamiliar(f.formation) + unfamiliar(f.formation) * 0.25,
    ['defensiveCompactness', 'positionalQuality', 'transitionReliability']);

  add('playingStyle', 'Playing style',
    previous?.playingStyle ?? '—', next.playingStyle,
    (previous && previous.playingStyle !== next.playingStyle ? 0.3 : 0) * unfamiliar(f.playingStyle)
      + unfamiliar(f.playingStyle) * 0.25,
    ['buildUpSecurity', 'transitionReliability']);

  add('pressing', 'Pressing intensity',
    previous?.pressing ?? '—', next.pressing,
    (previous && previous.pressing !== next.pressing ? 0.2 : 0) * unfamiliar(f.pressing)
      + unfamiliar(f.pressing) * 0.25,
    ['pressingCoordination']);

  add('defensiveApproach', 'Defensive approach',
    previous?.defensiveApproach ?? '—', next.defensiveApproach,
    (previous && previous.defensiveApproach !== next.defensiveApproach ? 0.25 : 0)
      * unfamiliar(f.defensiveOrganisation) + unfamiliar(f.defensiveOrganisation) * 0.25,
    ['defensiveCompactness', 'pressingCoordination']);

  add('buildUp', 'Build-up',
    previous?.buildUp ?? '—', next.buildUp,
    (previous && previous.buildUp !== next.buildUp ? 0.18 : 0) * unfamiliar(f.buildUp)
      + unfamiliar(f.buildUp) * 0.2,
    ['buildUpSecurity']);

  // Genuinely minor dials: small, bounded, and they fade quickly.
  if (previous) {
    const step = (a: string, b: string, label: string, area: string, cost: number, affects: ExecutionChannel[]) => {
      if (a !== b) add(area, label, a, b, cost, affects);
    };
    step(previous.defensiveLine, next.defensiveLine, 'Defensive line', 'defensiveLine', 0.06, ['defensiveCompactness']);
    step(previous.width, next.width, 'Width', 'width', 0.04, ['positionalQuality']);
    step(previous.tempo, next.tempo, 'Tempo', 'tempo', 0.04, ['buildUpSecurity']);
    step(previous.mentality, next.mentality, 'Mentality', 'mentality', 0.05, ['defensiveCompactness']);
    step(previous.setPieceApproach, next.setPieceApproach, 'Set-piece approach', 'setPieceApproach', 0.08, ['setPieceExecution']);
    step(previous.attackingFocus, next.attackingFocus, 'Attacking focus', 'attackingFocus', 0.05, ['positionalQuality']);
  }
  add('setPieces', 'Set-piece routines', '—', next.setPieceApproach,
    unfamiliar(familiarity.SET_PIECES) * 0.2, ['setPieceExecution']);
  add('transition', 'Transition play', '—', next.counterAttack ? 'Counter-attacking' : 'Standard',
    unfamiliar(familiarity.TRANSITION) * 0.2, ['transitionReliability']);

  const structuralChanged = changes.filter(
    (c) => STRUCTURAL_AREAS.has(c.area) && c.from !== '—' && c.from !== c.to);
  const simultaneous = structuralChanged.length >= 2;

  const disruption = emptyDisruption();
  for (const change of changes) {
    for (const channel of change.affects) {
      // Costs on the same channel compound but saturate.
      disruption[channel] = 1 - (1 - disruption[channel]) * (1 - change.cost * 0.6);
    }
  }
  if (simultaneous) {
    // Changing several structural things at once is worse than the sum of parts:
    // the players have no fixed reference point left.
    const extra = 0.12 * (structuralChanged.length - 1);
    for (const channel of Object.keys(disruption) as ExecutionChannel[]) {
      disruption[channel] = clamp(disruption[channel] + extra, 0, 1);
    }
  }

  const score = clamp(
    changes.reduce((acc, c) => acc + c.cost, 0) / 2.2 + (simultaneous ? 0.1 : 0),
    0, 1);

  // Calibrated so that rebuilding the back line — 4-3-3 to 3-5-2, say — is a
  // major change on its own, while a couple of dials is not.
  const magnitude: ChangeMagnitude =
    score < 0.08 ? 'NONE' : score < 0.2 ? 'MINOR' : score < 0.3 ? 'MODERATE' : 'MAJOR';

  const warnings: string[] = [];
  if (simultaneous) {
    warnings.push(`You are changing ${structuralChanged.map((c) => c.label.toLowerCase()).join(' and ')} in the same week. Expect the side to look disjointed.`);
  }
  if (f.formation < 45) {
    warnings.push(`The squad has only trained ${getFormation(next.formation).label} to ${Math.round(f.formation)}%. Shape and positioning will suffer.`);
  }
  if (f.pressing < 45 && (next.pressing === 'HIGH' || next.pressing === 'INTENSE')) {
    warnings.push(`Pressing familiarity is ${Math.round(f.pressing)}%. The press will be poorly timed and easy to play through.`);
  }
  if (f.buildUp < 45 && (next.buildUp === 'SHORT_PASSING' || next.playingStyle === 'POSSESSION')) {
    warnings.push(`Build-up familiarity is ${Math.round(f.buildUp)}%. Expect turnovers in your own third under pressure.`);
  }
  if (f.defensiveOrganisation < 45) {
    warnings.push(`Defensive organisation is unrehearsed at ${Math.round(f.defensiveOrganisation)}%. Gaps will open between the units.`);
  }
  if (f.setPieces < 40) {
    warnings.push(`Set-piece routines are at ${Math.round(f.setPieces)}%. Delivery and movement will be scrappy.`);
  }

  return { magnitude, score, changes, warnings, disruption, simultaneousStructuralChange: simultaneous };
}

// ---------------------------------------------------------------------------
// Execution modifiers consumed by the match engine
// ---------------------------------------------------------------------------

export interface ExecutionModifiers extends Record<ExecutionChannel, number> {}

/** Familiarity may move a channel by at most this fraction either way. */
export const EXECUTION_BAND = 0.1;

function channelModifier(familiarityValue: number, disruption: number): number {
  // 50 familiarity is the neutral point: it neither helps nor hurts.
  const base = (clamp(familiarityValue, 0, 100) - 50) / 50; // -1 .. 1
  return clamp(1 + base * EXECUTION_BAND - disruption * EXECUTION_BAND, 1 - EXECUTION_BAND, 1 + EXECUTION_BAND);
}

/**
 * Turn familiarity plus this week's change analysis into the handful of numbers
 * the engine multiplies through. Each channel is fed by its own dimension.
 */
export function executionModifiers(
  familiarity: ClubFamiliarity,
  plan: TacticalPlanInput,
  analysis: TacticalChangeAnalysis,
  positionalFamiliarity: number,
): ExecutionModifiers {
  const f = familiarityFor(familiarity, plan);
  return {
    pressingCoordination: channelModifier(f.pressing, analysis.disruption.pressingCoordination),
    buildUpSecurity: channelModifier(f.buildUp * 0.6 + f.playingStyle * 0.4, analysis.disruption.buildUpSecurity),
    defensiveCompactness: channelModifier(f.defensiveOrganisation * 0.65 + f.formation * 0.35, analysis.disruption.defensiveCompactness),
    positionalQuality: channelModifier(positionalFamiliarity * 0.6 + f.formation * 0.4, analysis.disruption.positionalQuality),
    transitionReliability: channelModifier(f.transition * 0.7 + f.playingStyle * 0.3, analysis.disruption.transitionReliability),
    setPieceExecution: channelModifier(f.setPieces, analysis.disruption.setPieceExecution),
  };
}

/** Average of the starters' familiarity with the role and position they are given. */
export function positionalFamiliarity(
  players: PlayerFamiliarityMap,
  starters: Array<{ playerId: string; role: PlayerRole; position: Position }>,
): number {
  if (starters.length === 0) return UNTRAINED_FAMILIARITY;
  const values = starters.map((s) => {
    const entry = players[s.playerId];
    const role = entry?.roles[s.role] ?? UNTRAINED_FAMILIARITY;
    const position = entry?.positions[s.position] ?? UNTRAINED_FAMILIARITY;
    return role * 0.55 + position * 0.45;
  });
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** A single headline number for the club dashboard. Display only. */
export function overallTacticalStability(f: ClubFamiliarity, plan: TacticalPlanInput | null): number {
  if (!plan) return Math.round(f.OVERALL_STABILITY);
  const v = familiarityFor(f, plan);
  return Math.round(
    v.formation * 0.22 + v.playingStyle * 0.18 + v.pressing * 0.13 +
    v.defensiveOrganisation * 0.15 + v.buildUp * 0.12 + v.transition * 0.08 +
    v.setPieces * 0.05 + f.OVERALL_STABILITY * 0.07,
  );
}

// ---------------------------------------------------------------------------
// Weekly progression
// ---------------------------------------------------------------------------

export const INTENSITY_MULTIPLIER: Record<TrainingIntensity, number> = {
  LIGHT: 0.55, NORMAL: 1, HIGH: 1.3, VERY_HIGH: 1.5,
};

/** Everything decays a little when it is not worked on. */
export const WEEKLY_DECAY = 1.3;

export interface FamiliarityProgressInput {
  familiarity: ClubFamiliarity;
  playerFamiliarity: PlayerFamiliarityMap;
  training: TrainingPlanInput;
  /** The plan the club is preparing, which is what training rehearses. */
  plan: TacticalPlanInput | null;
  /** The plan actually played this week, if a match took place. */
  playedPlan?: TacticalPlanInput | null;
  startersThisWeek: Array<{ playerId: string; role: PlayerRole; position: Position }>;
  startersLastWeek: string[];
  /**
   * Weekly drift is applied once per week. The simulator progresses familiarity
   * twice — training before the match, then the rehearsal value of actually
   * playing the system afterwards — so the second call skips the decay.
   */
  applyDecay?: boolean;
}

export interface FamiliarityProgressResult {
  familiarity: ClubFamiliarity;
  playerFamiliarity: PlayerFamiliarityMap;
  notes: string[];
}

function gain(current: number, amount: number): number {
  // Diminishing returns: the last ten points are much harder than the first ten.
  const headroom = (FAMILIARITY_CEILING - current) / FAMILIARITY_CEILING;
  return clamp(current + amount * (0.35 + 0.65 * headroom), FAMILIARITY_FLOOR, FAMILIARITY_CEILING);
}

function decay(current: number, amount = WEEKLY_DECAY): number {
  return clamp(current - amount, FAMILIARITY_FLOOR, FAMILIARITY_CEILING);
}

interface TrainingTarget {
  dimension: FamiliarityDimension;
  key: string | null;
  weight: number;
}

/** Which dimension a training focus actually rehearses, given the plan in hand. */
export function trainingTargets(
  focus: TrainingPlanInput['primaryFocus'],
  plan: TacticalPlanInput | null,
  targetFormation: Formation | null,
): TrainingTarget[] {
  switch (focus) {
    case 'RECOVERY':
    case 'FITNESS':
      return [];
    case 'POSSESSION':
      return [
        { dimension: 'BUILD_UP', key: plan?.buildUp ?? 'SHORT_PASSING', weight: 0.6 },
        { dimension: 'PLAYING_STYLE', key: plan?.playingStyle ?? 'POSSESSION', weight: 0.4 },
      ];
    case 'PRESSING':
      return [{ dimension: 'PRESSING', key: plan?.pressing ?? 'HIGH', weight: 1 }];
    case 'DEFENSIVE_ORGANISATION':
      return [{ dimension: 'DEFENSIVE_ORGANISATION', key: plan?.defensiveApproach ?? 'MID_BLOCK', weight: 1 }];
    case 'ATTACKING_PATTERNS':
      return [{ dimension: 'PLAYING_STYLE', key: plan?.playingStyle ?? 'BALANCED', weight: 1 }];
    case 'TRANSITION_PLAY':
      return [{ dimension: 'TRANSITION', key: null, weight: 1 }];
    case 'SET_PIECES':
      return [{ dimension: 'SET_PIECES', key: null, weight: 1 }];
    case 'FORMATION_FAMILIARITY':
      // A nominated target formation lets a manager rehearse a shape weeks before
      // playing it, which is the whole point of a gradual transition.
      return [{ dimension: 'FORMATION', key: targetFormation ?? plan?.formation ?? 'F_4_3_3', weight: 1 }];
    case 'INDIVIDUAL_ROLES':
      return [{ dimension: 'OVERALL_STABILITY', key: null, weight: 0.3 }];
    case 'MATCH_PREPARATION':
      return [
        { dimension: 'FORMATION', key: plan?.formation ?? 'F_4_3_3', weight: 0.4 },
        { dimension: 'OVERALL_STABILITY', key: null, weight: 0.3 },
        { dimension: 'SET_PIECES', key: null, weight: 0.3 },
      ];
    default:
      return [];
  }
}

const BASE_TRAINING_GAIN = 7.5;
const BASE_MATCH_GAIN = 5.5;

export function progressFamiliarity(input: FamiliarityProgressInput): FamiliarityProgressResult {
  const f: ClubFamiliarity = {
    FORMATION: { ...input.familiarity.FORMATION },
    PLAYING_STYLE: { ...input.familiarity.PLAYING_STYLE },
    PRESSING: { ...input.familiarity.PRESSING },
    DEFENSIVE_ORGANISATION: { ...input.familiarity.DEFENSIVE_ORGANISATION },
    BUILD_UP: { ...input.familiarity.BUILD_UP },
    TRANSITION: input.familiarity.TRANSITION,
    SET_PIECES: input.familiarity.SET_PIECES,
    OVERALL_STABILITY: input.familiarity.OVERALL_STABILITY,
  };
  const notes: string[] = [];

  // 1. Everything the squad is not working on slips a little.
  if (input.applyDecay !== false) {
  for (const key of Object.keys(f.FORMATION) as Formation[]) f.FORMATION[key] = decay(f.FORMATION[key]!);
  for (const key of Object.keys(f.PLAYING_STYLE) as PlayingStyle[]) f.PLAYING_STYLE[key] = decay(f.PLAYING_STYLE[key]!);
  for (const key of Object.keys(f.PRESSING) as PressingIntensity[]) f.PRESSING[key] = decay(f.PRESSING[key]!);
  for (const key of Object.keys(f.DEFENSIVE_ORGANISATION) as DefensiveApproach[]) f.DEFENSIVE_ORGANISATION[key] = decay(f.DEFENSIVE_ORGANISATION[key]!);
  for (const key of Object.keys(f.BUILD_UP) as BuildUp[]) f.BUILD_UP[key] = decay(f.BUILD_UP[key]!);
  f.TRANSITION = decay(f.TRANSITION);
  f.SET_PIECES = decay(f.SET_PIECES);
  f.OVERALL_STABILITY = decay(f.OVERALL_STABILITY, 0.8);
  }

  const applyTarget = (target: TrainingTarget, amount: number) => {
    const value = amount * target.weight;
    switch (target.dimension) {
      case 'FORMATION': {
        const key = target.key as Formation;
        f.FORMATION[key] = gain(f.FORMATION[key] ?? UNTRAINED_FAMILIARITY, value);
        break;
      }
      case 'PLAYING_STYLE': {
        const key = target.key as PlayingStyle;
        f.PLAYING_STYLE[key] = gain(f.PLAYING_STYLE[key] ?? UNTRAINED_FAMILIARITY, value);
        break;
      }
      case 'PRESSING': {
        const key = target.key as PressingIntensity;
        f.PRESSING[key] = gain(f.PRESSING[key] ?? UNTRAINED_FAMILIARITY, value);
        break;
      }
      case 'DEFENSIVE_ORGANISATION': {
        const key = target.key as DefensiveApproach;
        f.DEFENSIVE_ORGANISATION[key] = gain(f.DEFENSIVE_ORGANISATION[key] ?? UNTRAINED_FAMILIARITY, value);
        break;
      }
      case 'BUILD_UP': {
        const key = target.key as BuildUp;
        f.BUILD_UP[key] = gain(f.BUILD_UP[key] ?? UNTRAINED_FAMILIARITY, value);
        break;
      }
      case 'TRANSITION':
        f.TRANSITION = gain(f.TRANSITION, value);
        break;
      case 'SET_PIECES':
        f.SET_PIECES = gain(f.SET_PIECES, value);
        break;
      case 'OVERALL_STABILITY':
        f.OVERALL_STABILITY = gain(f.OVERALL_STABILITY, value);
        break;
    }
  };

  // 2. Training.
  const multiplier = INTENSITY_MULTIPLIER[input.training.intensity];
  const targetFormation = input.training.targetFormation ?? null;
  for (const target of trainingTargets(input.training.primaryFocus, input.plan, targetFormation)) {
    applyTarget(target, BASE_TRAINING_GAIN * multiplier);
  }
  for (const target of trainingTargets(input.training.secondaryFocus, input.plan, targetFormation)) {
    applyTarget(target, BASE_TRAINING_GAIN * multiplier * 0.45);
  }

  // 3. Playing the system is the best rehearsal of all.
  const played = input.playedPlan;
  if (played) {
    f.FORMATION[played.formation] = gain(f.FORMATION[played.formation] ?? UNTRAINED_FAMILIARITY, BASE_MATCH_GAIN);
    f.PLAYING_STYLE[played.playingStyle] = gain(f.PLAYING_STYLE[played.playingStyle] ?? UNTRAINED_FAMILIARITY, BASE_MATCH_GAIN);
    f.PRESSING[played.pressing] = gain(f.PRESSING[played.pressing] ?? UNTRAINED_FAMILIARITY, BASE_MATCH_GAIN * 0.8);
    f.DEFENSIVE_ORGANISATION[played.defensiveApproach] = gain(f.DEFENSIVE_ORGANISATION[played.defensiveApproach] ?? UNTRAINED_FAMILIARITY, BASE_MATCH_GAIN * 0.8);
    f.BUILD_UP[played.buildUp] = gain(f.BUILD_UP[played.buildUp] ?? UNTRAINED_FAMILIARITY, BASE_MATCH_GAIN * 0.7);
    f.TRANSITION = gain(f.TRANSITION, BASE_MATCH_GAIN * 0.5);
    f.SET_PIECES = gain(f.SET_PIECES, BASE_MATCH_GAIN * 0.35);
  }

  // 4. Selection stability. A settled eleven understands itself.
  if (input.startersLastWeek.length > 0 && input.startersThisWeek.length > 0) {
    const previous = new Set(input.startersLastWeek);
    const retained = input.startersThisWeek.filter((s) => previous.has(s.playerId)).length;
    const ratio = retained / input.startersThisWeek.length;
    if (ratio >= 0.8) {
      f.OVERALL_STABILITY = gain(f.OVERALL_STABILITY, 4);
      notes.push('A settled side is growing into its patterns.');
    } else if (ratio <= 0.5) {
      f.OVERALL_STABILITY = decay(f.OVERALL_STABILITY, 4);
      notes.push(`Only ${retained} of the previous eleven kept their place; the side looked unfamiliar with each other.`);
    }
  }

  // 5. Individual role and position familiarity.
  const players: PlayerFamiliarityMap = {};
  for (const [id, entry] of Object.entries(input.playerFamiliarity)) {
    players[id] = { roles: { ...entry.roles }, positions: { ...entry.positions } };
  }
  const ensure = (id: string) => {
    if (!players[id]) players[id] = { roles: {}, positions: {} };
    return players[id];
  };
  const individual = new Map(input.training.individualFocus.map((i) => [i.playerId, i.role]));
  for (const [playerId, role] of individual) {
    const entry = ensure(playerId);
    const complexity = ROLE_DEFINITIONS[role].complexity;
    entry.roles[role] = gain(entry.roles[role] ?? UNTRAINED_FAMILIARITY, (9 / complexity) * multiplier);
  }
  for (const starter of input.startersThisWeek) {
    const entry = ensure(starter.playerId);
    const complexity = ROLE_DEFINITIONS[starter.role].complexity;
    entry.roles[starter.role] = gain(entry.roles[starter.role] ?? UNTRAINED_FAMILIARITY, 6 / complexity);
    entry.positions[starter.position] = gain(entry.positions[starter.position] ?? UNTRAINED_FAMILIARITY, 5);
  }

  return { familiarity: f, playerFamiliarity: players, notes };
}
