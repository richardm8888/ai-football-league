'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { getViewer } from '@/services/auth';
import { assignClub, startSeason, LeagueError } from '@/services/league';
import { advancePhase, MatchdayError, reopenMatchday } from '@/services/matchday';
import { openNextMatchday, simulateMatchday, SimulationError } from '@/services/simulation';
import { requireUser } from '@/services/page-context';

/**
 * League administration.
 *
 * These actions move the whole league forward, so they are restricted to league
 * owners and administrators and every one of them is audited by the service it
 * calls.
 */

export interface AdminActionState {
  error?: string;
  message?: string;
}

async function requireLeagueAdmin(leagueId: string) {
  const user = await requireUser();
  const viewer = await getViewer(user.id);
  const membership = await prisma.leagueMembership.findUnique({
    where: { leagueId_userId: { leagueId, userId: user.id } },
  });
  const allowed = viewer.isSuperAdmin
    || membership?.role === 'OWNER'
    || membership?.role === 'ADMIN';
  if (!allowed) throw new LeagueError('Only a league administrator can do that.');
  return user;
}

export async function advancePhaseAction(
  _state: AdminActionState, formData: FormData,
): Promise<AdminActionState> {
  const leagueId = String(formData.get('leagueId') ?? '');
  const matchdayId = String(formData.get('matchdayId') ?? '');
  try {
    const user = await requireLeagueAdmin(leagueId);
    const phase = await advancePhase(matchdayId, user.id);
    revalidatePath('/admin');
    revalidatePath('/club');
    return { message: `Matchday moved to ${phase.replace(/_/g, ' ').toLowerCase()}.` };
  } catch (error) {
    if (error instanceof MatchdayError || error instanceof LeagueError) return { error: error.message };
    throw error;
  }
}

export async function simulateMatchdayAction(
  _state: AdminActionState, formData: FormData,
): Promise<AdminActionState> {
  const leagueId = String(formData.get('leagueId') ?? '');
  const matchdayId = String(formData.get('matchdayId') ?? '');
  const force = formData.get('force') === '1';
  try {
    const user = await requireLeagueAdmin(leagueId);
    const summary = await simulateMatchday(matchdayId, user.id, { force });
    revalidatePath('/admin');
    revalidatePath('/club');
    revalidatePath('/match-centre');
    revalidatePath('/reports');
    revalidatePath('/league');
    return {
      message: `Matchday ${summary.matchdayNumber} played: ${summary.matches
        .map((m) => `${m.homeClub} ${m.homeGoals}-${m.awayGoals} ${m.awayClub}`)
        .join(', ')}.`,
    };
  } catch (error) {
    if (error instanceof SimulationError || error instanceof LeagueError) return { error: error.message };
    throw error;
  }
}

export async function openNextMatchdayAction(
  _state: AdminActionState, formData: FormData,
): Promise<AdminActionState> {
  const leagueId = String(formData.get('leagueId') ?? '');
  const matchdayId = String(formData.get('matchdayId') ?? '');
  try {
    const user = await requireLeagueAdmin(leagueId);
    const next = await openNextMatchday(matchdayId, user.id);
    revalidatePath('/admin');
    revalidatePath('/club');
    return { message: next ? `Matchday ${next.number} is open.` : 'The season is complete.' };
  } catch (error) {
    if (error instanceof LeagueError) return { error: error.message };
    throw error;
  }
}

export async function reopenMatchdayAction(
  _state: AdminActionState, formData: FormData,
): Promise<AdminActionState> {
  const leagueId = String(formData.get('leagueId') ?? '');
  const matchdayId = String(formData.get('matchdayId') ?? '');
  try {
    const user = await requireLeagueAdmin(leagueId);
    await reopenMatchday(matchdayId, user.id);
    revalidatePath('/admin');
    revalidatePath('/tactics');
    return { message: 'Matchday reopened. Managers can edit their plans again.' };
  } catch (error) {
    if (error instanceof MatchdayError || error instanceof LeagueError) return { error: error.message };
    throw error;
  }
}

export async function assignClubAction(
  _state: AdminActionState, formData: FormData,
): Promise<AdminActionState> {
  const leagueId = String(formData.get('leagueId') ?? '');
  const clubId = String(formData.get('clubId') ?? '');
  const userId = String(formData.get('userId') ?? '') || null;
  try {
    await requireLeagueAdmin(leagueId);
    await assignClub(leagueId, clubId, userId);
    revalidatePath('/admin');
    revalidatePath('/league');
    return { message: 'Club reassigned.' };
  } catch (error) {
    if (error instanceof LeagueError) return { error: error.message };
    throw error;
  }
}

export async function startSeasonAction(
  _state: AdminActionState, formData: FormData,
): Promise<AdminActionState> {
  const leagueId = String(formData.get('leagueId') ?? '');
  try {
    const user = await requireLeagueAdmin(leagueId);
    const result = await startSeason({ leagueId, userId: user.id });
    revalidatePath('/admin');
    revalidatePath('/club');
    return { message: `${result.season.name} created with ${result.clubs.length} clubs and ${result.matchdays} matchdays.` };
  } catch (error) {
    if (error instanceof LeagueError) return { error: error.message };
    throw error;
  }
}
