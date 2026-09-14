'use server';

import { revalidatePath } from 'next/cache';
import { askCoach, resolveDecision } from '@/ai/coach';
import { prisma } from '@/lib/db';
import { lineupSelectionSchema, tacticalPlanSchema, trainingPlanSchema } from '@/domain/schemas';
import type { MatchdayPhase } from '@/domain/types';
import { canManageClub } from '@/domain/visibility';
import { getViewer } from '@/services/auth';
import { getOrCreateMatchPlan, PlanError, saveMatchPlan, saveTrainingPlan } from '@/services/plans';
import { requireUser } from '@/services/page-context';

/**
 * Server actions for the coaching staff.
 *
 * Two separate steps, deliberately: asking for advice never changes anything,
 * and applying advice writes a draft that the manager still has to approve and
 * lock on the tactics screen.
 */

export interface CoachActionState {
  error?: string;
  message?: string;
}

async function authoriseClub(clubId: string) {
  const user = await requireUser();
  const viewer = await getViewer(user.id);
  if (!canManageClub(viewer, clubId)) throw new PlanError('You do not manage this club.');
  return user;
}

export async function askCoachAction(
  _state: CoachActionState, formData: FormData,
): Promise<CoachActionState> {
  const clubId = String(formData.get('clubId') ?? '');
  const message = String(formData.get('message') ?? '').trim();
  if (message.length === 0) return { error: 'Say something to your coaching staff first.' };

  const user = await authoriseClub(clubId);
  const matchdayId = String(formData.get('matchdayId') ?? '') || null;

  try {
    const result = await askCoach({ clubId, userId: user.id, message, matchdayId });
    revalidatePath('/coach');
    return {
      message: result.fallbackUsed
        ? 'Answered by the local coach because the provider was unavailable.'
        : undefined,
    };
  } catch (error) {
    // Even a total failure must leave the manager able to work manually.
    return {
      error: `The coaching staff could not answer: ${(error as Error).message} You can still set tactics and training yourself.`,
    };
  }
}

/**
 * Apply an AI proposal as a draft. The manager still reviews, approves and locks
 * it in the normal way, so the AI never commits anything on its own.
 */
export async function applyProposalAction(
  _state: CoachActionState, formData: FormData,
): Promise<CoachActionState> {
  const decisionId = String(formData.get('decisionId') ?? '');
  const user = await requireUser();

  const decision = await prisma.aiDecision.findUnique({ where: { id: decisionId } });
  if (!decision) return { error: 'That proposal no longer exists.' };
  await authoriseClub(decision.clubId);

  if (decision.status === 'INVALID') {
    return { error: 'That proposal failed validation and cannot be applied.' };
  }

  try {
    if (decision.kind === 'TACTICAL_PLAN') {
      const payload = decision.proposal as { tactics?: unknown; lineup?: unknown };
      const fixture = await prisma.fixture.findFirst({
        where: {
          matchday: { phase: { not: 'COMPLETE' } },
          OR: [{ homeClubId: decision.clubId }, { awayClubId: decision.clubId }],
        },
        include: { matchday: true },
        orderBy: { matchday: { number: 'asc' } },
      });
      if (!fixture) return { error: 'There is no fixture to apply this to.' };

      const existing = await getOrCreateMatchPlan(fixture.id, decision.clubId);
      const tactics = tacticalPlanSchema.parse({ ...existing.tactics, ...(payload.tactics ?? {}) });
      const lineup = payload.lineup
        ? lineupSelectionSchema.parse(payload.lineup)
        : existing.lineup;

      await saveMatchPlan({
        fixtureId: fixture.id,
        clubId: decision.clubId,
        userId: user.id,
        phase: fixture.matchday.phase as MatchdayPhase,
        plan: { tactics, lineup, notes: existing.notes },
        source: 'AI_ASSISTED',
        approve: false,
      });
    } else if (decision.kind === 'TRAINING_PLAN') {
      const matchday = await prisma.matchday.findFirst({
        where: { season: { league: { clubs: { some: { id: decision.clubId } } } }, phase: { not: 'COMPLETE' } },
        orderBy: { number: 'asc' },
      });
      if (!matchday) return { error: 'There is no matchday to apply this to.' };
      await saveTrainingPlan({
        clubId: decision.clubId,
        matchdayId: matchday.id,
        userId: user.id,
        phase: matchday.phase as MatchdayPhase,
        plan: trainingPlanSchema.parse(decision.proposal),
        source: 'AI_ASSISTED',
        approve: false,
      });
    } else {
      return { error: 'That kind of proposal cannot be applied directly.' };
    }

    await resolveDecision(decisionId, user.id, 'APPROVED');
  } catch (error) {
    if (error instanceof PlanError) return { error: error.message };
    return { error: (error as Error).message };
  }

  revalidatePath('/coach');
  revalidatePath('/tactics');
  revalidatePath('/training');
  return {
    message: decision.kind === 'TRAINING_PLAN'
      ? 'Applied as a training draft. Review and approve it on the training screen.'
      : 'Applied as a draft. Review the warnings and approve it on the tactics screen.',
  };
}

export async function rejectProposalAction(
  _state: CoachActionState, formData: FormData,
): Promise<CoachActionState> {
  const decisionId = String(formData.get('decisionId') ?? '');
  const user = await requireUser();
  const decision = await prisma.aiDecision.findUnique({ where: { id: decisionId } });
  if (!decision) return {};
  await authoriseClub(decision.clubId);
  await resolveDecision(decisionId, user.id, 'REJECTED');
  revalidatePath('/coach');
  return { message: 'Noted. The proposal was not applied.' };
}
