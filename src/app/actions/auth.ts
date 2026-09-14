'use server';

import { redirect } from 'next/navigation';
import { env } from '@/lib/env';
import {
  AuthError, authenticate, clearSession, createSession, registerUser, setSessionCookie,
} from '@/services/auth';
import { createLeague, joinLeague, LeagueError, startSeason } from '@/services/league';
import { requireUser } from '@/services/page-context';

export interface ActionState {
  error?: string;
  message?: string;
}

export async function signInAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await authenticate(
      String(formData.get('email') ?? ''), String(formData.get('password') ?? ''));
    await setSessionCookie(await createSession(user.id));
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    throw error;
  }
  redirect('/club');
}

export async function signUpAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  if (!env.allowOpenRegistration && !formData.get('inviteCode')) {
    return { error: 'This installation requires a league invite code to register.' };
  }
  try {
    const user = await registerUser({
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      displayName: String(formData.get('displayName') ?? ''),
    });
    await setSessionCookie(await createSession(user.id));
    const inviteCode = String(formData.get('inviteCode') ?? '').trim();
    if (inviteCode) await joinLeague(user.id, inviteCode);
  } catch (error) {
    if (error instanceof AuthError || error instanceof LeagueError) return { error: error.message };
    throw error;
  }
  redirect('/club');
}

export async function signOutAction(): Promise<void> {
  await clearSession();
  redirect('/login');
}

export async function joinLeagueAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await joinLeague(user.id, String(formData.get('inviteCode') ?? ''));
  } catch (error) {
    if (error instanceof LeagueError) return { error: error.message };
    throw error;
  }
  redirect('/club');
}

export async function createLeagueAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const league = await createLeague(user.id, String(formData.get('name') ?? ''));
    if (formData.get('startSeason') === 'on') {
      await startSeason({ leagueId: league.id, userId: user.id });
    }
  } catch (error) {
    if (error instanceof LeagueError) return { error: error.message };
    throw error;
  }
  redirect('/club');
}
