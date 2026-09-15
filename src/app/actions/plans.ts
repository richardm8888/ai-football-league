'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { fingerprint } from '@/lib/fingerprint';
import type { MatchdayPhase } from '@/domain/types';
import type { ValidationResult } from '@/domain/validation';
import { canManageClub } from '@/domain/visibility';
import { getViewer } from '@/services/auth';
import { lockMatchPlan, PlanError, saveMatchPlan, saveTrainingPlan } from '@/services/plans';
import { settleMatchdayIfReady } from '@/services/simulation';
import { requireUser } from '@/services/page-context';

/**
 * Server actions for a manager's own decisions.
 *
 * Every action re-establishes who the caller is and whether they manage this
 * club. The client is never trusted with authorisation, and the matchday phase
 * is read from the database rather than accepted from the form.
 */

export interface PlanActionState {
  error?: string;
  message?: string;
  validation?: ValidationResult;
  /**
   * What the submission actually did, for the control that did it.
   *
   * `plan` is the fingerprint of the plan that was stored, so an editor can
   * tell "saved, and this is still it" from "saved, and then you changed
   * something" without keeping its own bookkeeping or running a timer.
   */
  outcome?: {
    kind: 'SAVED' | 'APPROVED' | 'LOCKED';
    at: string;
    plan?: string;
  };
}

async function authoriseClub(clubId: string) {
  const user = await requireUser();
  const viewer = await getViewer(user.id);
  if (!canManageClub(viewer, clubId)) {
    throw new PlanError('You do not manage this club.');
  }
  return user;
}

async function phaseForFixture(fixtureId: string): Promise<MatchdayPhase> {
  const fixture = await prisma.fixture.findUniqueOrThrow({
    where: { id: fixtureId }, include: { matchday: true },
  });
  return fixture.matchday.phase as MatchdayPhase;
}

export async function saveMatchPlanAction(
  _state: PlanActionState, formData: FormData,
): Promise<PlanActionState> {
  const fixtureId = String(formData.get('fixtureId') ?? '');
  const clubId = String(formData.get('clubId') ?? '');
  const approve = formData.get('approve') === '1';
  const planJson = String(formData.get('plan') ?? '{}');

  try {
    const user = await authoriseClub(clubId);
    const plan = JSON.parse(planJson);
    await saveMatchPlan({
      fixtureId, clubId, userId: user.id,
      phase: await phaseForFixture(fixtureId),
      plan, approve, source: formData.get('source') === 'AI_ASSISTED' ? 'AI_ASSISTED' : 'MANUAL',
    });
  } catch (error) {
    if (error instanceof PlanError) return { error: error.message, validation: error.validation };
    throw error;
  }
  revalidatePath('/tactics');
  revalidatePath('/club');
  return {
    message: approve ? 'Plan approved. Lock it in when you are ready.' : 'Draft saved.',
    outcome: {
      kind: approve ? 'APPROVED' : 'SAVED',
      at: new Date().toISOString(),
      plan: fingerprint(planJson),
    },
  };
}

export async function lockMatchPlanAction(
  _state: PlanActionState, formData: FormData,
): Promise<PlanActionState> {
  const fixtureId = String(formData.get('fixtureId') ?? '');
  const clubId = String(formData.get('clubId') ?? '');
  let played = false;
  try {
    const user = await authoriseClub(clubId);
    await lockMatchPlan(fixtureId, clubId, user.id, await phaseForFixture(fixtureId));

    // Locking in is the last thing the league was waiting for often enough that
    // it is worth checking every time: if this was the final manager, the match
    // plays now rather than when somebody remembers to press a button.
    const fixture = await prisma.fixture.findUnique({
      where: { id: fixtureId }, select: { matchdayId: true },
    });
    if (fixture) played = (await settleMatchdayIfReady(fixture.matchdayId, user.id)) !== null;
  } catch (error) {
    if (error instanceof PlanError) return { error: error.message, validation: error.validation };
    throw error;
  }
  revalidatePath('/tactics');
  revalidatePath('/club');
  revalidatePath('/match-centre');
  revalidatePath('/reports');
  return {
    message: played
      ? 'Locked in. That was the last club, so the matchday has been played.'
      : 'Locked in. Your plan is frozen until the matchday is simulated.',
    outcome: { kind: 'LOCKED', at: new Date().toISOString() },
  };
}

export async function saveTrainingPlanAction(
  _state: PlanActionState, formData: FormData,
): Promise<PlanActionState> {
  const clubId = String(formData.get('clubId') ?? '');
  const matchdayId = String(formData.get('matchdayId') ?? '');
  const approve = formData.get('approve') === '1';
  const planJson = String(formData.get('plan') ?? '{}');
  try {
    const user = await authoriseClub(clubId);
    const matchday = await prisma.matchday.findUniqueOrThrow({ where: { id: matchdayId } });
    await saveTrainingPlan({
      clubId, matchdayId, userId: user.id,
      phase: matchday.phase as MatchdayPhase,
      plan: JSON.parse(planJson),
      approve,
      source: formData.get('source') === 'AI_ASSISTED' ? 'AI_ASSISTED' : 'MANUAL',
    });
  } catch (error) {
    if (error instanceof PlanError) return { error: error.message, validation: error.validation };
    throw error;
  }
  revalidatePath('/training');
  revalidatePath('/club');
  return {
    message: approve ? 'Training approved.' : 'Training draft saved.',
    outcome: {
      kind: approve ? 'APPROVED' : 'SAVED',
      at: new Date().toISOString(),
      plan: fingerprint(planJson),
    },
  };
}
