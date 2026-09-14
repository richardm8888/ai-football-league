import { getFormation } from '../tactics/formations';
import { isRoleValidForPosition, ROLE_DEFINITIONS } from '../tactics/roles';
import { positionSuitability, suitabilityBand } from '../tactics/suitability';
import type {
  LineupSelectionInput, MatchPlanInput, TacticalPlanInput, TrainingPlanInput,
} from '../schemas';
import type { MatchdayPhase, PlanStatus, Position, PlayerRole } from '../types';

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
  /** ERROR blocks submission. WARNING is shown to the manager but allowed. */
  severity: 'ERROR' | 'WARNING';
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface SquadPlayerView {
  id: string;
  name: string;
  primaryPosition: Position;
  secondaryPositions: Position[];
  fitness: number;
  injured: boolean;
  injuryDescription?: string | null;
  suspended: boolean;
}

const err = (code: string, message: string, path?: string): ValidationIssue =>
  ({ code, message, path, severity: 'ERROR' });
const warn = (code: string, message: string, path?: string): ValidationIssue =>
  ({ code, message, path, severity: 'WARNING' });

function result(issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter((i) => i.severity === 'ERROR');
  const warnings = issues.filter((i) => i.severity === 'WARNING');
  return { ok: errors.length === 0, errors, warnings };
}

export function mergeResults(...results: ValidationResult[]): ValidationResult {
  return result(results.flatMap((r) => [...r.errors, ...r.warnings]));
}

// ---------------------------------------------------------------------------
// Line-up
// ---------------------------------------------------------------------------

/** Below this a player physically cannot be asked to start. */
export const MINIMUM_START_FITNESS = 40;
/** Below this the manager is warned but may proceed. */
export const ADVISED_START_FITNESS = 65;
export const MINIMUM_BENCH_SIZE = 3;

export function validateLineup(
  lineup: LineupSelectionInput,
  tactics: Pick<TacticalPlanInput, 'formation'>,
  squad: SquadPlayerView[],
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const formation = getFormation(tactics.formation);
  const squadById = new Map(squad.map((p) => [p.id, p]));

  // Slots must match the formation exactly.
  const required = new Set(formation.slots.map((s) => s.key));
  const seenSlots = new Set<string>();
  for (const entry of lineup.starters) {
    if (!required.has(entry.slot)) {
      issues.push(err('SLOT_NOT_IN_FORMATION',
        `Slot ${entry.slot} does not exist in ${formation.label}.`, `starters.${entry.slot}`));
      continue;
    }
    if (seenSlots.has(entry.slot)) {
      issues.push(err('SLOT_DUPLICATED', `Slot ${entry.slot} is filled twice.`, `starters.${entry.slot}`));
    }
    seenSlots.add(entry.slot);
  }
  for (const key of required) {
    if (!seenSlots.has(key)) {
      issues.push(err('SLOT_EMPTY', `No player selected for ${key}.`, `starters.${key}`));
    }
  }

  // Players must be real, available and used once.
  const used = new Map<string, string>();
  const checkPlayer = (playerId: string, where: string, starting: boolean) => {
    const player = squadById.get(playerId);
    if (!player) {
      issues.push(err('PLAYER_NOT_IN_SQUAD',
        'Selected player is not in this squad.', where));
      return null;
    }
    if (used.has(playerId)) {
      issues.push(err('PLAYER_DUPLICATED',
        `${player.name} is selected more than once.`, where));
    }
    used.set(playerId, where);
    if (player.injured) {
      issues.push(err('PLAYER_INJURED',
        `${player.name} is injured${player.injuryDescription ? ` (${player.injuryDescription})` : ''}.`, where));
    }
    if (player.suspended) {
      issues.push(err('PLAYER_SUSPENDED', `${player.name} is suspended.`, where));
    }
    if (starting && player.fitness < MINIMUM_START_FITNESS) {
      issues.push(err('PLAYER_UNFIT',
        `${player.name} is only ${player.fitness}% fit and cannot start.`, where));
    } else if (starting && player.fitness < ADVISED_START_FITNESS) {
      issues.push(warn('PLAYER_LOW_FITNESS',
        `${player.name} is ${player.fitness}% fit and is likely to tire.`, where));
    }
    return player;
  };

  let goalkeepersStarting = 0;
  for (const entry of lineup.starters) {
    const where = `starters.${entry.slot}`;
    const player = checkPlayer(entry.playerId, where, true);
    const slot = formation.slots.find((s) => s.key === entry.slot);
    if (!player || !slot) continue;

    if (!isRoleValidForPosition(entry.role, slot.position)) {
      issues.push(err('ROLE_NOT_VALID_FOR_POSITION',
        `${ROLE_DEFINITIONS[entry.role].label} cannot be played at ${slot.label}.`, where));
    }
    if (slot.position === 'GK') {
      goalkeepersStarting += 1;
      const canKeep = player.primaryPosition === 'GK' || player.secondaryPositions.includes('GK');
      if (!canKeep) {
        issues.push(err('NON_KEEPER_IN_GOAL',
          `${player.name} is not a goalkeeper and cannot play in goal.`, where));
      }
    } else if (player.primaryPosition === 'GK') {
      issues.push(err('KEEPER_OUTFIELD',
        `${player.name} is a goalkeeper and cannot play outfield.`, where));
    }

    const suitability = positionSuitability(player, slot.position);
    const band = suitabilityBand(suitability);
    if (band === 'MAKESHIFT') {
      issues.push(warn('PLAYER_OUT_OF_POSITION',
        `${player.name} is makeshift at ${slot.label} and will struggle positionally.`, where));
    } else if (band === 'AWKWARD') {
      issues.push(warn('PLAYER_AWKWARD_POSITION',
        `${player.name} is not a natural ${slot.label}.`, where));
    }
  }

  if (goalkeepersStarting !== 1 && required.has('GK')) {
    issues.push(err('GOALKEEPER_COUNT', 'Exactly one goalkeeper must start.'));
  }

  const benchOrders = new Set<number>();
  for (const entry of lineup.bench) {
    const where = `bench.${entry.playerId}`;
    checkPlayer(entry.playerId, where, false);
    if (benchOrders.has(entry.order)) {
      issues.push(err('BENCH_ORDER_DUPLICATED', 'Two substitutes share the same bench slot.', where));
    }
    benchOrders.add(entry.order);
  }

  if (lineup.bench.length < MINIMUM_BENCH_SIZE) {
    issues.push(warn('BENCH_TOO_SMALL',
      `Only ${lineup.bench.length} substitutes named; ${MINIMUM_BENCH_SIZE} or more is advisable.`, 'bench'));
  }
  const benchHasKeeper = lineup.bench.some((b) => {
    const p = squadById.get(b.playerId);
    return p?.primaryPosition === 'GK';
  });
  if (lineup.bench.length > 0 && !benchHasKeeper) {
    issues.push(warn('NO_BACKUP_KEEPER', 'No goalkeeper on the bench.', 'bench'));
  }

  if (lineup.captainPlayerId) {
    if (!lineup.starters.some((s) => s.playerId === lineup.captainPlayerId)) {
      issues.push(err('CAPTAIN_NOT_STARTING', 'The captain must be in the starting eleven.', 'captain'));
    }
  }

  return result(issues);
}

// ---------------------------------------------------------------------------
// Tactics
// ---------------------------------------------------------------------------

/**
 * Combinations that contradict each other. These are genuine incompatibilities,
 * not merely unusual choices, so they block submission rather than warn.
 */
export function validateTactics(tactics: TacticalPlanInput): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (tactics.defensiveApproach === 'AGGRESSIVE_PRESSING' && tactics.pressing === 'LOW') {
    issues.push(err('PRESSING_CONTRADICTION',
      'An aggressive pressing approach cannot be run at low pressing intensity.', 'pressing'));
  }
  if (tactics.defensiveApproach === 'LOW_BLOCK' && tactics.pressing === 'INTENSE') {
    issues.push(err('BLOCK_CONTRADICTION',
      'A low block cannot press intensely; choose a mid-block or raise the line.', 'defensiveApproach'));
  }
  if (tactics.defensiveApproach === 'LOW_BLOCK' && tactics.defensiveLine === 'VERY_HIGH') {
    issues.push(err('LINE_CONTRADICTION',
      'A low block and a very high defensive line are mutually exclusive.', 'defensiveLine'));
  }
  if (tactics.offsideTrap && tactics.defensiveLine === 'DEEP') {
    issues.push(err('OFFSIDE_TRAP_DEEP',
      'An offside trap needs at least a standard defensive line.', 'offsideTrap'));
  }

  if (tactics.playingStyle === 'POSSESSION' && tactics.buildUp === 'LONG_DISTRIBUTION') {
    issues.push(warn('STYLE_BUILDUP_MISMATCH',
      'Possession football with long distribution surrenders the ball cheaply.', 'buildUp'));
  }
  if (tactics.playingStyle === 'COUNTER_ATTACKING' && tactics.defensiveLine === 'VERY_HIGH') {
    issues.push(warn('COUNTER_HIGH_LINE',
      'Counter-attacking works best with space to run into; a very high line removes it.', 'defensiveLine'));
  }
  if (tactics.playingStyle === 'PATIENT_BUILD_UP' && (tactics.tempo === 'FAST' || tactics.tempo === 'VERY_FAST')) {
    issues.push(warn('PATIENT_FAST_TEMPO',
      'Patient build-up at a fast tempo produces rushed, low-quality passes.', 'tempo'));
  }
  if (tactics.pressing === 'INTENSE' && tactics.defensiveLine === 'DEEP') {
    issues.push(warn('PRESS_WITHOUT_LINE',
      'Pressing intensely behind a deep line leaves a large gap between the units.', 'defensiveLine'));
  }
  if (tactics.riskTolerance === 'RECKLESS' && tactics.mentality === 'VERY_DEFENSIVE') {
    issues.push(warn('RISK_MENTALITY_MISMATCH',
      'Reckless risk-taking undermines a very defensive mentality.', 'riskTolerance'));
  }
  if (tactics.counterPress && tactics.pressing === 'LOW') {
    issues.push(warn('COUNTERPRESS_LOW',
      'Counter-pressing at low intensity rarely wins the ball back.', 'counterPress'));
  }
  if (tactics.fullBackFreedom > 75 && tactics.defensiveLine === 'VERY_HIGH' && !tactics.offsideTrap) {
    issues.push(warn('EXPOSED_FLANKS',
      'Very attacking full-backs behind a very high line leave the channels open.', 'fullBackFreedom'));
  }

  const triggers = new Set<string>();
  tactics.matchStateInstructions.forEach((ins, i) => {
    if (triggers.has(ins.trigger)) {
      issues.push(err('DUPLICATE_TRIGGER',
        `Two instructions both fire on ${ins.trigger}.`, `matchStateInstructions.${i}`));
    }
    triggers.add(ins.trigger);
  });

  return result(issues);
}

export function validateSubstitutionPlan(
  tactics: TacticalPlanInput,
  lineup: LineupSelectionInput,
  squad: SquadPlayerView[],
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const names = new Map(squad.map((p) => [p.id, p.name]));
  const starters = new Set(lineup.starters.map((s) => s.playerId));
  const bench = new Set(lineup.bench.map((b) => b.playerId));
  const comingOn = new Set<string>();
  const goingOff = new Set<string>();

  tactics.substitutionPlan.forEach((sub, i) => {
    const path = `substitutionPlan.${i}`;
    if (!starters.has(sub.outPlayerId)) {
      issues.push(err('SUB_OUT_NOT_STARTING',
        `${names.get(sub.outPlayerId) ?? 'Player'} is not in the starting eleven.`, path));
    }
    if (!bench.has(sub.inPlayerId)) {
      issues.push(err('SUB_IN_NOT_ON_BENCH',
        `${names.get(sub.inPlayerId) ?? 'Player'} is not on the bench.`, path));
    }
    if (goingOff.has(sub.outPlayerId)) {
      issues.push(err('SUB_OUT_TWICE', 'The same player is substituted off twice.', path));
    }
    if (comingOn.has(sub.inPlayerId)) {
      issues.push(err('SUB_IN_TWICE', 'The same substitute is brought on twice.', path));
    }
    goingOff.add(sub.outPlayerId);
    comingOn.add(sub.inPlayerId);
  });

  if (tactics.substitutionPlan.length > 5) {
    issues.push(err('TOO_MANY_SUBS', 'At most five substitutions may be planned.', 'substitutionPlan'));
  }
  return result(issues);
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export function validateTrainingPlan(
  plan: TrainingPlanInput,
  squad: SquadPlayerView[],
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const byId = new Map(squad.map((p) => [p.id, p]));
  const seen = new Set<string>();

  plan.individualFocus.forEach((focus, i) => {
    const path = `individualFocus.${i}`;
    const player = byId.get(focus.playerId);
    if (!player) {
      issues.push(err('PLAYER_NOT_IN_SQUAD', 'Player is not in this squad.', path));
      return;
    }
    if (seen.has(focus.playerId)) {
      issues.push(err('INDIVIDUAL_FOCUS_DUPLICATED',
        `${player.name} has two individual sessions.`, path));
    }
    seen.add(focus.playerId);
    if (player.injured) {
      issues.push(warn('INDIVIDUAL_FOCUS_INJURED',
        `${player.name} is injured and will gain little from individual work.`, path));
    }
    const role: PlayerRole = focus.role;
    const suits = ROLE_DEFINITIONS[role].positions.some(
      (p) => p === player.primaryPosition || player.secondaryPositions.includes(p));
    if (!suits) {
      issues.push(warn('INDIVIDUAL_FOCUS_UNSUITED',
        `${player.name} is being trained in ${ROLE_DEFINITIONS[role].label}, a role outside their positions.`, path));
    }
  });

  const heavy = plan.intensity === 'VERY_HIGH';
  const tacticalHeavy = plan.primaryFocus !== 'RECOVERY' && plan.secondaryFocus !== 'RECOVERY';
  if (heavy && tacticalHeavy) {
    issues.push(warn('HIGH_INJURY_RISK',
      'Very high intensity with no recovery work markedly raises injury risk.', 'intensity'));
  }
  const tiredSquad = squad.filter((p) => !p.injured && p.fitness < 70).length;
  if (heavy && tiredSquad >= Math.ceil(squad.length / 3)) {
    issues.push(warn('SQUAD_TOO_TIRED',
      `${tiredSquad} players are below 70% fitness; very high intensity will leave them short for the match.`, 'intensity'));
  }
  return result(issues);
}

// ---------------------------------------------------------------------------
// Phase and authorisation gates
// ---------------------------------------------------------------------------

const EDITABLE_PHASES: MatchdayPhase[] = [
  'WEEK_OPEN', 'ANALYSIS', 'PREPARATION', 'TACTICAL_SUBMISSION', 'REVIEW_AND_APPROVAL',
];

export function canEditPlans(phase: MatchdayPhase, planStatus: PlanStatus): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!EDITABLE_PHASES.includes(phase)) {
    issues.push(err('PHASE_CLOSED',
      `Plans cannot be changed once the matchday reaches ${phase.replace(/_/g, ' ').toLowerCase()}.`));
  }
  if (planStatus === 'LOCKED') {
    issues.push(err('PLAN_LOCKED',
      'This plan is locked. An administrator must reopen the matchday to change it.'));
  }
  return result(issues);
}

export function canLockPlan(phase: MatchdayPhase): ValidationResult {
  const allowed: MatchdayPhase[] = ['TACTICAL_SUBMISSION', 'REVIEW_AND_APPROVAL', 'PREPARATION'];
  return result(allowed.includes(phase)
    ? []
    : [err('PHASE_NOT_READY', `Plans cannot be locked during ${phase.replace(/_/g, ' ').toLowerCase()}.`)]);
}

// ---------------------------------------------------------------------------
// Whole-plan validation
// ---------------------------------------------------------------------------

export function validateMatchPlan(plan: MatchPlanInput, squad: SquadPlayerView[]): ValidationResult {
  return mergeResults(
    validateTactics(plan.tactics),
    validateLineup(plan.lineup, plan.tactics, squad),
    validateSubstitutionPlan(plan.tactics, plan.lineup, squad),
  );
}
