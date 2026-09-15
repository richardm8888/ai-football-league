/**
 * Applying and undoing a coaching proposal.
 *
 * A manager instructs the staff in plain English and the instruction is the
 * decision — there is no second button to press. That only works if two things
 * hold: the manager can see exactly what changed, and can put it back in one
 * tap if the staff read the instruction differently than it was meant.
 *
 * Nothing here loosens the safety model. A proposal still has to parse against
 * the domain schemas and revalidate against the real squad, it still lands as a
 * DRAFT, and locking before the deadline is still the manager's own act. What
 * has gone is a confirmation click that sat above the reply where nobody saw it.
 *
 * This file deliberately imports nothing from src/ai: the AI layer sits above
 * the services and asks them to do things, never the other way round.
 */
import { prisma } from '@/lib/db';
import {
  lineupSelectionSchema, tacticalPlanSchema, trainingPlanSchema,
  type LineupSelectionInput, type TacticalPlanInput, type TrainingPlanInput,
} from '@/domain/schemas';
import {
  describeLineupChange, describeTacticalChange, describeTrainingChange,
} from '@/domain/reports/changes';
import type { ValidationResult } from '@/domain/validation';
import type { MatchdayPhase } from '@/domain/types';
import { recordAudit } from '@/services/audit';
import {
  getOrCreateMatchPlan, getOrCreateTrainingPlan, PlanError, saveMatchPlan, saveTrainingPlan,
} from '@/services/plans';

export interface AppliedChange {
  kind: 'TACTICAL_PLAN' | 'TRAINING_PLAN';
  /** One line per thing that moved. Empty means the plan already said this. */
  changes: string[];
  warnings: string[];
}

/** Snapshot of the plan a proposal replaced, kept so it can be restored. */
type PreviousState =
  | { kind: 'TACTICAL_PLAN'; fixtureId: string; tactics: unknown; lineup: unknown }
  | { kind: 'TRAINING_PLAN'; matchdayId: string; plan: unknown };

async function playerNamer(clubId: string): Promise<(id: string) => string> {
  const players = await prisma.player.findMany({
    where: { clubId },
    select: { id: true, lastName: true },
  });
  const byId = new Map(players.map((p) => [p.id, p.lastName]));
  // An unknown id is a squad that moved under us, not worth throwing over.
  return (id) => byId.get(id) ?? 'a player';
}

async function nextFixtureFor(clubId: string) {
  return prisma.fixture.findFirst({
    where: {
      matchday: { phase: { not: 'COMPLETE' } },
      OR: [{ homeClubId: clubId }, { awayClubId: clubId }],
    },
    include: { matchday: true },
    orderBy: { matchday: { number: 'asc' } },
  });
}

async function nextMatchdayFor(clubId: string) {
  return prisma.matchday.findFirst({
    where: { season: { league: { clubs: { some: { id: clubId } } } }, phase: { not: 'COMPLETE' } },
    orderBy: { number: 'asc' },
  });
}

/**
 * Apply a proposal to the club's draft plan and report what moved.
 *
 * Throws PlanError when the matchday phase forbids it or the proposal does not
 * survive revalidation, which is the same gate a manual edit passes through.
 */
export async function applyDecision(decisionId: string, userId: string): Promise<AppliedChange> {
  const decision = await prisma.aiDecision.findUnique({ where: { id: decisionId } });
  if (!decision) throw new PlanError('That proposal no longer exists.');
  if (decision.status === 'INVALID') {
    throw new PlanError('That proposal failed validation and cannot be applied.');
  }

  if (decision.kind === 'TACTICAL_PLAN') {
    const fixture = await nextFixtureFor(decision.clubId);
    if (!fixture) throw new PlanError('There is no fixture to apply this to.');

    const existing = await getOrCreateMatchPlan(fixture.id, decision.clubId);
    const payload = decision.proposal as { tactics?: unknown; lineup?: unknown };

    const before: PreviousState = {
      kind: 'TACTICAL_PLAN',
      fixtureId: fixture.id,
      tactics: existing.tactics,
      lineup: existing.lineup,
    };

    // Merged onto the existing plan, so an instruction about pressing does not
    // silently reset everything the manager has already settled.
    const tactics = tacticalPlanSchema.parse({ ...existing.tactics, ...(payload.tactics ?? {}) });
    const lineup = payload.lineup
      ? lineupSelectionSchema.parse(payload.lineup)
      : existing.lineup;

    const result = await saveMatchPlan({
      fixtureId: fixture.id,
      clubId: decision.clubId,
      userId,
      phase: fixture.matchday.phase as MatchdayPhase,
      plan: { tactics, lineup, notes: existing.notes },
      source: 'AI_ASSISTED',
      approve: false,
    });

    const nameOf = await playerNamer(decision.clubId);
    const changes = [
      ...describeTacticalChange(existing.tactics as TacticalPlanInput, tactics),
      ...describeLineupChange(existing.lineup as LineupSelectionInput, lineup, nameOf),
    ];

    await markApplied(decision.id, userId, before, changes);
    return { kind: 'TACTICAL_PLAN', changes, warnings: warningTexts(result) };
  }

  if (decision.kind === 'TRAINING_PLAN') {
    const matchday = await nextMatchdayFor(decision.clubId);
    if (!matchday) throw new PlanError('There is no matchday to apply this to.');

    const existing = await getOrCreateTrainingPlan(decision.clubId, matchday.id);
    const plan = trainingPlanSchema.parse(decision.proposal);

    const before: PreviousState = {
      kind: 'TRAINING_PLAN',
      matchdayId: matchday.id,
      plan: {
        primaryFocus: existing.primaryFocus,
        secondaryFocus: existing.secondaryFocus,
        intensity: existing.intensity,
        targetFormation: existing.targetFormation,
        individualFocus: [],
        notes: existing.notes ?? '',
      },
    };

    const result = await saveTrainingPlan({
      clubId: decision.clubId,
      matchdayId: matchday.id,
      userId,
      phase: matchday.phase as MatchdayPhase,
      plan,
      source: 'AI_ASSISTED',
      approve: false,
    });

    const changes = describeTrainingChange(
      (before as { plan: TrainingPlanInput }).plan, plan);

    await markApplied(decision.id, userId, before, changes);
    return { kind: 'TRAINING_PLAN', changes, warnings: warningTexts(result) };
  }

  throw new PlanError('That kind of proposal cannot be applied directly.');
}

/** Put back whatever the proposal replaced. */
export async function undoDecision(decisionId: string, userId: string): Promise<string[]> {
  const decision = await prisma.aiDecision.findUnique({ where: { id: decisionId } });
  if (!decision) throw new PlanError('That change no longer exists.');
  if (!decision.previousState) throw new PlanError('There is nothing to undo for that change.');
  if (decision.status === 'UNDONE') throw new PlanError('That change has already been undone.');

  const before = decision.previousState as PreviousState;

  if (before.kind === 'TACTICAL_PLAN') {
    const fixture = await prisma.fixture.findUnique({
      where: { id: before.fixtureId }, include: { matchday: true },
    });
    if (!fixture) throw new PlanError('That fixture no longer exists.');

    await saveMatchPlan({
      fixtureId: before.fixtureId,
      clubId: decision.clubId,
      userId,
      phase: fixture.matchday.phase as MatchdayPhase,
      plan: {
        tactics: tacticalPlanSchema.parse(before.tactics),
        lineup: lineupSelectionSchema.parse(before.lineup),
        notes: '',
      },
      source: 'MANUAL',
      approve: false,
    });
  } else {
    const matchday = await prisma.matchday.findUnique({ where: { id: before.matchdayId } });
    if (!matchday) throw new PlanError('That matchday no longer exists.');

    await saveTrainingPlan({
      clubId: decision.clubId,
      matchdayId: before.matchdayId,
      userId,
      phase: matchday.phase as MatchdayPhase,
      plan: trainingPlanSchema.parse(before.plan),
      source: 'MANUAL',
      approve: false,
    });
  }

  await prisma.aiDecision.update({
    where: { id: decisionId },
    data: { status: 'UNDONE' },
  });
  await recordAudit({
    action: 'AI_CHANGE_UNDONE',
    entity: 'AiDecision',
    entityId: decisionId,
    clubId: decision.clubId,
    userId,
  });

  return ['Put back the plan as it was before that instruction.'];
}

async function markApplied(
  decisionId: string, userId: string, before: PreviousState, changes: string[],
): Promise<void> {
  await prisma.aiDecision.update({
    where: { id: decisionId },
    data: {
      status: 'APPROVED',
      approvedById: userId,
      approvedAt: new Date(),
      appliedAt: new Date(),
      previousState: JSON.parse(JSON.stringify(before)),
    },
  });
  await recordAudit({
    action: 'AI_CHANGE_APPLIED',
    entity: 'AiDecision',
    entityId: decisionId,
    userId,
    after: { changes },
  });
}

function warningTexts(result: { validation: ValidationResult }): string[] {
  return result.validation.warnings.map((w) => w.message);
}
