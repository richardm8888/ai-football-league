'use server';

import { revalidatePath } from 'next/cache';
import { claimClub, LeagueError } from '@/services/league';
import { requireUser } from '@/services/page-context';

/**
 * Taking charge of a club.
 *
 * Which club you manage is the first real decision of the game, so it is the
 * manager's to make rather than something handed out in join order.
 */

export interface ClaimActionState {
  error?: string;
  message?: string;
}

export async function claimClubAction(
  _state: ClaimActionState, formData: FormData,
): Promise<ClaimActionState> {
  const leagueId = String(formData.get('leagueId') ?? '');
  const clubId = String(formData.get('clubId') ?? '');
  try {
    const user = await requireUser();
    const club = await claimClub(leagueId, clubId, user.id);
    for (const path of ['/choose-club', '/club', '/league', '/squad', '/tactics', '/training']) {
      revalidatePath(path);
    }
    return { message: `You are the manager of ${club.name}.` };
  } catch (error) {
    if (error instanceof LeagueError) return { error: error.message };
    throw error;
  }
}
