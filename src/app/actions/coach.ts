'use server';

import { revalidatePath } from 'next/cache';
import { askCoach, resolveDecision } from '@/ai/coach';
import { prisma } from '@/lib/db';
import { canManageClub } from '@/domain/visibility';
import { getViewer } from '@/services/auth';
import { applyDecision, undoDecision } from '@/services/ai-decisions';
import { PlanError } from '@/services/plans';
import { requireUser } from '@/services/page-context';

/**
 * Server actions for the coaching staff.
 *
 * Telling the staff what you want IS the decision. A proposal that survives
 * validation is applied to the draft plan there and then, the reply says what
 * moved, and one tap puts it back. The manager still approves and locks the
 * plan before the deadline, which is where the real commitment has always been.
 *
 * The earlier design asked for a second click on a card that rendered above the
 * reply, so managers read the advice, never saw the button, and concluded the
 * coach did not do anything.
 */

export interface CoachActionState {
  error?: string;
  message?: string;
  /** What the instruction actually changed, and how to put it back. */
  applied?: { changes: string[]; warnings: string[]; decisionIds: string[] };
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

    // Apply whatever survived validation. Each is attempted on its own so a
    // training plan still lands when the tactical half is refused, and so a
    // locked matchday returns the advice rather than swallowing it.
    const changes: string[] = [];
    const warnings: string[] = [];
    const decisionIds: string[] = [];
    const refusals: string[] = [];

    for (const decision of result.decisions) {
      if (decision.status !== 'PROPOSED') continue;
      try {
        const applied = await applyDecision(decision.id, user.id);
        changes.push(...applied.changes);
        warnings.push(...applied.warnings);
        decisionIds.push(decision.id);
      } catch (error) {
        refusals.push(error instanceof PlanError
          ? error.message
          : `That could not be applied: ${(error as Error).message}`);
      }
    }

    revalidatePath('/coach');
    revalidatePath('/tactics');
    revalidatePath('/training');
    revalidatePath('/squad');

    const notes: string[] = [];
    if (result.fallbackUsed) {
      notes.push('Answered by the local coach because the provider was unavailable.');
    }
    notes.push(...refusals);

    return {
      message: notes.length > 0 ? notes.join(' ') : undefined,
      applied: decisionIds.length > 0
        ? { changes, warnings, decisionIds }
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
 * Apply a proposal explicitly.
 *
 * Instructions apply themselves, so this is only reached for a proposal that
 * could not be applied at the time — a matchday that was locked and has since
 * been reopened, most likely.
 */
export async function applyProposalAction(
  _state: CoachActionState, formData: FormData,
): Promise<CoachActionState> {
  const decisionId = String(formData.get('decisionId') ?? '');
  const user = await requireUser();

  const decision = await prisma.aiDecision.findUnique({ where: { id: decisionId } });
  if (!decision) return { error: 'That proposal no longer exists.' };
  await authoriseClub(decision.clubId);

  try {
    const applied = await applyDecision(decisionId, user.id);
    revalidatePath('/coach');
    revalidatePath('/tactics');
    revalidatePath('/training');
    revalidatePath('/squad');
    return {
      applied: {
        changes: applied.changes,
        warnings: applied.warnings,
        decisionIds: [decisionId],
      },
    };
  } catch (error) {
    if (error instanceof PlanError) return { error: error.message };
    return { error: (error as Error).message };
  }
}

/**
 * Put back the plan as it was before an instruction.
 *
 * This is what makes applying on sight safe: a misread instruction costs one
 * tap rather than a matchday.
 */
export async function undoChangeAction(
  _state: CoachActionState, formData: FormData,
): Promise<CoachActionState> {
  const ids = String(formData.get('decisionIds') ?? '').split(',').filter(Boolean);
  if (ids.length === 0) return { error: 'There is nothing to undo.' };

  const user = await requireUser();

  // Newest first, so undoing several from one instruction rewinds in the order
  // they were applied rather than leaving a half-restored plan.
  for (const id of [...ids].reverse()) {
    const decision = await prisma.aiDecision.findUnique({ where: { id } });
    if (!decision) continue;
    await authoriseClub(decision.clubId);
    try {
      await undoDecision(id, user.id);
    } catch (error) {
      if (error instanceof PlanError) return { error: error.message };
      return { error: (error as Error).message };
    }
  }

  revalidatePath('/coach');
  revalidatePath('/tactics');
  revalidatePath('/training');
  revalidatePath('/squad');
  return { message: 'Put back. Your plan is as it was before that instruction.' };
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
