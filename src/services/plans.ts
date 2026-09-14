import { prisma } from '@/lib/db';
import { analyseTacticalChange, type TacticalChangeAnalysis } from '@/domain/familiarity';
import {
  lineupSelectionSchema, matchPlanSchema, tacticalPlanSchema, trainingPlanSchema,
  type LineupSelectionInput, type MatchPlanInput, type TacticalPlanInput, type TrainingPlanInput,
} from '@/domain/schemas';
import { getFormation } from '@/domain/tactics/formations';
import { autoSelectLineup, defaultSubstitutionPlan, defaultTacticalPlan } from '@/domain/tactics/selection';
import {
  canEditPlans, canLockPlan, mergeResults, validateMatchPlan, validateTrainingPlan,
  type ValidationResult,
} from '@/domain/validation';
import type { Formation, MatchdayPhase, PlanStatus } from '@/domain/types';
import { recordAudit } from './audit';
import {
  loadClubFamiliarity, loadSquad, toSelectableView, toValidationView, type SquadPlayer,
} from './club';

/**
 * Match and training plans.
 *
 * This is the only door into a club's competitive decisions. Whether a change
 * arrives from a form, a server action or an approved AI proposal, it lands here
 * and is validated against the squad, the tactical rules and the matchday phase
 * before anything is written.
 */

export class PlanError extends Error {
  constructor(message: string, readonly validation?: ValidationResult) {
    super(message);
  }
}

export interface MatchPlanView {
  id: string;
  fixtureId: string;
  clubId: string;
  status: PlanStatus;
  source: 'MANUAL' | 'AI_ASSISTED';
  notes: string;
  tactics: TacticalPlanInput;
  lineup: LineupSelectionInput;
  changeAnalysis: TacticalChangeAnalysis | null;
  approvedAt: Date | null;
  lockedAt: Date | null;
}

/** The plan a club last actually played, used to price this week's changes. */
export async function getPreviousPlayedPlan(clubId: string): Promise<TacticalPlanInput | null> {
  const plan = await prisma.matchPlan.findFirst({
    where: { clubId, fixture: { match: { isNot: null } } },
    orderBy: { fixture: { matchday: { number: 'desc' } } },
    include: { tactics: true },
  });
  if (!plan?.tactics) return null;
  return toTacticalInput(plan.tactics);
}

function toTacticalInput(row: {
  formation: string; mentality: string; playingStyle: string; pressing: string;
  defensiveLine: string; buildUp: string; width: string; defensiveApproach: string;
  tempo: string; riskTolerance: string; attackingFocus: string; setPieceApproach: string;
  counterPress: boolean; counterAttack: boolean; offsideTrap: boolean; fullBackFreedom: number;
  matchStateInstructions: unknown; substitutionPlan: unknown;
}): TacticalPlanInput {
  return tacticalPlanSchema.parse({
    formation: row.formation,
    mentality: row.mentality,
    playingStyle: row.playingStyle,
    pressing: row.pressing,
    defensiveLine: row.defensiveLine,
    buildUp: row.buildUp,
    width: row.width,
    defensiveApproach: row.defensiveApproach,
    tempo: row.tempo,
    riskTolerance: row.riskTolerance,
    attackingFocus: row.attackingFocus,
    setPieceApproach: row.setPieceApproach,
    counterPress: row.counterPress,
    counterAttack: row.counterAttack,
    offsideTrap: row.offsideTrap,
    fullBackFreedom: row.fullBackFreedom,
    matchStateInstructions: row.matchStateInstructions ?? [],
    substitutionPlan: row.substitutionPlan ?? [],
  });
}

/**
 * Fetch a club's plan for a fixture, creating a sensible default the first time.
 * A manager is never confronted with an empty pitch.
 */
export async function getOrCreateMatchPlan(
  fixtureId: string, clubId: string, squad?: SquadPlayer[],
): Promise<MatchPlanView> {
  const existing = await prisma.matchPlan.findUnique({
    where: { fixtureId_clubId: { fixtureId, clubId } },
    include: { tactics: true, lineup: { include: { assignments: true } } },
  });

  if (existing?.tactics && existing.lineup) {
    const starters = existing.lineup.assignments
      .filter((a) => a.isStarter)
      .map((a) => ({ slot: a.slot, playerId: a.playerId, role: a.role as never }));
    const bench = existing.lineup.assignments
      .filter((a) => !a.isStarter)
      .sort((a, b) => (a.benchOrder ?? 0) - (b.benchOrder ?? 0))
      .map((a, i) => ({ playerId: a.playerId, order: a.benchOrder ?? i }));
    return {
      id: existing.id,
      fixtureId, clubId,
      status: existing.status as PlanStatus,
      source: existing.source as 'MANUAL' | 'AI_ASSISTED',
      notes: existing.notes,
      tactics: toTacticalInput(existing.tactics),
      lineup: { starters, bench, captainPlayerId: existing.lineup.captainPlayerId ?? undefined },
      changeAnalysis: (existing.tactics.changeAnalysis as TacticalChangeAnalysis | null) ?? null,
      approvedAt: existing.approvedAt,
      lockedAt: existing.lockedAt,
    };
  }

  // Build a default: the club's most familiar shape and the best available side.
  const players = squad ?? await loadSquad(clubId);
  const familiarity = await loadClubFamiliarity(clubId);
  const preferredFormation = (Object.entries(familiarity.FORMATION)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? 'F_4_3_3') as Formation;

  const tactics = defaultTacticalPlan(preferredFormation);
  const selectable = toSelectableView(players);
  const lineup = autoSelectLineup(selectable, preferredFormation);
  tactics.substitutionPlan = defaultSubstitutionPlan(lineup, selectable, preferredFormation);

  const saved = await writeMatchPlan({
    fixtureId, clubId, tactics, lineup, notes: '', source: 'MANUAL', status: 'DRAFT',
  });
  return saved;
}

interface WriteInput {
  fixtureId: string;
  clubId: string;
  tactics: TacticalPlanInput;
  lineup: LineupSelectionInput;
  notes: string;
  source: 'MANUAL' | 'AI_ASSISTED';
  status: PlanStatus;
  changeAnalysis?: TacticalChangeAnalysis | null;
}

async function writeMatchPlan(input: WriteInput): Promise<MatchPlanView> {
  const plan = await prisma.matchPlan.upsert({
    where: { fixtureId_clubId: { fixtureId: input.fixtureId, clubId: input.clubId } },
    create: {
      fixtureId: input.fixtureId, clubId: input.clubId,
      status: input.status, source: input.source, notes: input.notes,
    },
    update: { status: input.status, source: input.source, notes: input.notes },
  });

  const tacticsData = {
    formation: input.tactics.formation,
    mentality: input.tactics.mentality,
    playingStyle: input.tactics.playingStyle,
    pressing: input.tactics.pressing,
    defensiveLine: input.tactics.defensiveLine,
    buildUp: input.tactics.buildUp,
    width: input.tactics.width,
    defensiveApproach: input.tactics.defensiveApproach,
    tempo: input.tactics.tempo,
    riskTolerance: input.tactics.riskTolerance,
    attackingFocus: input.tactics.attackingFocus,
    setPieceApproach: input.tactics.setPieceApproach,
    counterPress: input.tactics.counterPress,
    counterAttack: input.tactics.counterAttack,
    offsideTrap: input.tactics.offsideTrap,
    fullBackFreedom: input.tactics.fullBackFreedom,
    matchStateInstructions: input.tactics.matchStateInstructions,
    substitutionPlan: input.tactics.substitutionPlan,
    changeAnalysis: input.changeAnalysis === undefined
      ? undefined
      : (input.changeAnalysis as never),
  };

  await prisma.tacticalPlan.upsert({
    where: { matchPlanId: plan.id },
    create: { matchPlanId: plan.id, ...tacticsData },
    update: tacticsData,
  });

  const lineup = await prisma.lineup.upsert({
    where: { matchPlanId: plan.id },
    create: { matchPlanId: plan.id, captainPlayerId: input.lineup.captainPlayerId ?? null },
    update: { captainPlayerId: input.lineup.captainPlayerId ?? null },
  });

  await prisma.playerRoleAssignment.deleteMany({ where: { lineupId: lineup.id } });
  const positions = await prisma.player.findMany({
    where: { id: { in: [...input.lineup.starters.map((s) => s.playerId), ...input.lineup.bench.map((b) => b.playerId)] } },
    select: { id: true, primaryPosition: true },
  });
  const positionById = new Map(positions.map((p) => [p.id, p.primaryPosition]));
  const slots = getFormation(input.tactics.formation).slots;

  await prisma.playerRoleAssignment.createMany({
    data: [
      ...input.lineup.starters.map((s) => ({
        lineupId: lineup.id,
        playerId: s.playerId,
        slot: s.slot,
        position: (slots.find((x) => x.key === s.slot)?.position ?? positionById.get(s.playerId) ?? 'MC') as never,
        role: s.role as never,
        isStarter: true,
      })),
      ...input.lineup.bench.map((b) => ({
        lineupId: lineup.id,
        playerId: b.playerId,
        slot: 'BENCH',
        position: (positionById.get(b.playerId) ?? 'MC') as never,
        role: 'CENTRAL_MIDFIELDER' as never,
        isStarter: false,
        benchOrder: b.order,
      })),
    ],
  });

  return {
    id: plan.id,
    fixtureId: input.fixtureId,
    clubId: input.clubId,
    status: input.status,
    source: input.source,
    notes: input.notes,
    tactics: input.tactics,
    lineup: input.lineup,
    changeAnalysis: input.changeAnalysis ?? null,
    approvedAt: plan.approvedAt,
    lockedAt: plan.lockedAt,
  };
}

export interface SaveMatchPlanInput {
  fixtureId: string;
  clubId: string;
  userId: string;
  phase: MatchdayPhase;
  plan: unknown;
  source?: 'MANUAL' | 'AI_ASSISTED';
  /** Approving in the same step is how the review screen commits a plan. */
  approve?: boolean;
}

export interface SaveMatchPlanResult {
  plan: MatchPlanView;
  validation: ValidationResult;
  analysis: TacticalChangeAnalysis;
}

export async function saveMatchPlan(input: SaveMatchPlanInput): Promise<SaveMatchPlanResult> {
  const existing = await prisma.matchPlan.findUnique({
    where: { fixtureId_clubId: { fixtureId: input.fixtureId, clubId: input.clubId } },
  });
  const gate = canEditPlans(input.phase, (existing?.status as PlanStatus) ?? 'DRAFT');
  if (!gate.ok) throw new PlanError(gate.errors[0].message, gate);

  const parsed = matchPlanSchema.safeParse(input.plan);
  if (!parsed.success) {
    throw new PlanError('That plan is not a valid set of instructions.', {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        code: 'SCHEMA', message: i.message, path: i.path.join('.'), severity: 'ERROR' as const,
      })),
      warnings: [],
    });
  }

  const squad = await loadSquad(input.clubId);
  const validation = validateMatchPlan(parsed.data as MatchPlanInput, toValidationView(squad));
  if (!validation.ok) throw new PlanError('This plan cannot be submitted yet.', validation);

  const [familiarity, previous] = await Promise.all([
    loadClubFamiliarity(input.clubId),
    getPreviousPlayedPlan(input.clubId),
  ]);
  const analysis = analyseTacticalChange(parsed.data.tactics, familiarity, previous);

  const plan = await writeMatchPlan({
    fixtureId: input.fixtureId,
    clubId: input.clubId,
    tactics: parsed.data.tactics,
    lineup: parsed.data.lineup,
    notes: parsed.data.notes,
    source: input.source ?? 'MANUAL',
    status: input.approve ? 'APPROVED' : 'DRAFT',
    changeAnalysis: analysis,
  });

  if (input.approve) {
    await prisma.matchPlan.update({
      where: { id: plan.id },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });
    plan.status = 'APPROVED';
  }

  await recordAudit({
    action: input.approve ? 'MATCH_PLAN_APPROVED' : 'MATCH_PLAN_SAVED',
    entity: 'MatchPlan', entityId: plan.id, clubId: input.clubId, userId: input.userId,
    after: { tactics: parsed.data.tactics, changeMagnitude: analysis.magnitude, source: plan.source },
  });

  return { plan, validation, analysis };
}

export async function lockMatchPlan(
  fixtureId: string, clubId: string, userId: string, phase: MatchdayPhase,
): Promise<void> {
  const gate = canLockPlan(phase);
  if (!gate.ok) throw new PlanError(gate.errors[0].message, gate);

  const plan = await prisma.matchPlan.findUnique({
    where: { fixtureId_clubId: { fixtureId, clubId } },
    include: { tactics: true, lineup: { include: { assignments: true } } },
  });
  if (!plan?.tactics || !plan.lineup) throw new PlanError('There is no plan to lock.');
  if (plan.status === 'LOCKED') return;

  // Revalidate at the moment of locking: fitness and injuries move during the week.
  const squad = await loadSquad(clubId);
  const tactics = toTacticalInput(plan.tactics);
  const lineup = lineupSelectionSchema.parse({
    starters: plan.lineup.assignments.filter((a) => a.isStarter)
      .map((a) => ({ slot: a.slot, playerId: a.playerId, role: a.role })),
    bench: plan.lineup.assignments.filter((a) => !a.isStarter)
      .map((a, i) => ({ playerId: a.playerId, order: a.benchOrder ?? i })),
    captainPlayerId: plan.lineup.captainPlayerId ?? undefined,
  });
  const validation = validateMatchPlan({ tactics, lineup, notes: plan.notes }, toValidationView(squad));
  if (!validation.ok) throw new PlanError('This plan is no longer valid and cannot be locked.', validation);

  await prisma.matchPlan.update({
    where: { id: plan.id },
    data: { status: 'LOCKED', lockedAt: new Date(), approvedAt: plan.approvedAt ?? new Date() },
  });
  await recordAudit({
    action: 'MATCH_PLAN_LOCKED', entity: 'MatchPlan', entityId: plan.id,
    clubId, userId, after: { formation: tactics.formation },
  });
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export function defaultTrainingPlan(): TrainingPlanInput {
  return trainingPlanSchema.parse({
    primaryFocus: 'MATCH_PREPARATION',
    secondaryFocus: 'RECOVERY',
    intensity: 'NORMAL',
    targetFormation: null,
    individualFocus: [],
    notes: '',
  });
}

export async function getOrCreateTrainingPlan(clubId: string, matchdayId: string) {
  const existing = await prisma.trainingPlan.findUnique({
    where: { clubId_matchdayId: { clubId, matchdayId } },
  });
  if (existing) return existing;
  const plan = defaultTrainingPlan();
  return prisma.trainingPlan.create({
    data: {
      clubId, matchdayId,
      primaryFocus: plan.primaryFocus,
      secondaryFocus: plan.secondaryFocus,
      intensity: plan.intensity,
      targetFormation: plan.targetFormation,
      individualFocus: plan.individualFocus,
      notes: plan.notes,
    },
  });
}

export function toTrainingInput(row: {
  primaryFocus: string; secondaryFocus: string; intensity: string;
  targetFormation: string | null; individualFocus: unknown; notes: string;
}): TrainingPlanInput {
  return trainingPlanSchema.parse({
    primaryFocus: row.primaryFocus,
    secondaryFocus: row.secondaryFocus,
    intensity: row.intensity,
    targetFormation: row.targetFormation,
    individualFocus: row.individualFocus ?? [],
    notes: row.notes,
  });
}

export interface SaveTrainingInput {
  clubId: string;
  matchdayId: string;
  userId: string;
  phase: MatchdayPhase;
  plan: unknown;
  source?: 'MANUAL' | 'AI_ASSISTED';
  approve?: boolean;
}

export async function saveTrainingPlan(input: SaveTrainingInput) {
  const existing = await prisma.trainingPlan.findUnique({
    where: { clubId_matchdayId: { clubId: input.clubId, matchdayId: input.matchdayId } },
  });
  const gate = canEditPlans(input.phase, (existing?.status as PlanStatus) ?? 'DRAFT');
  if (!gate.ok) throw new PlanError(gate.errors[0].message, gate);

  const parsed = trainingPlanSchema.safeParse(input.plan);
  if (!parsed.success) {
    throw new PlanError('That training plan is not valid.', {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        code: 'SCHEMA', message: i.message, path: i.path.join('.'), severity: 'ERROR' as const,
      })),
      warnings: [],
    });
  }

  const squad = await loadSquad(input.clubId);
  const validation = validateTrainingPlan(parsed.data, toValidationView(squad));
  if (!validation.ok) throw new PlanError('This training plan cannot be submitted.', validation);

  const data = {
    primaryFocus: parsed.data.primaryFocus,
    secondaryFocus: parsed.data.secondaryFocus,
    intensity: parsed.data.intensity,
    targetFormation: parsed.data.targetFormation,
    individualFocus: parsed.data.individualFocus,
    notes: parsed.data.notes,
    source: input.source ?? 'MANUAL',
    status: (input.approve ? 'APPROVED' : 'DRAFT') as PlanStatus,
    approvedAt: input.approve ? new Date() : null,
  };

  const saved = await prisma.trainingPlan.upsert({
    where: { clubId_matchdayId: { clubId: input.clubId, matchdayId: input.matchdayId } },
    create: { clubId: input.clubId, matchdayId: input.matchdayId, ...data },
    update: data,
  });

  await recordAudit({
    action: input.approve ? 'TRAINING_PLAN_APPROVED' : 'TRAINING_PLAN_SAVED',
    entity: 'TrainingPlan', entityId: saved.id, clubId: input.clubId, userId: input.userId,
    after: { primaryFocus: data.primaryFocus, secondaryFocus: data.secondaryFocus, intensity: data.intensity },
  });

  return { plan: saved, validation };
}

export async function validateOnly(clubId: string, plan: unknown): Promise<ValidationResult> {
  const parsed = matchPlanSchema.safeParse(plan);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        code: 'SCHEMA', message: i.message, path: i.path.join('.'), severity: 'ERROR' as const,
      })),
      warnings: [],
    };
  }
  const squad = await loadSquad(clubId);
  return mergeResults(validateMatchPlan(parsed.data, toValidationView(squad)));
}

export { toTacticalInput };
