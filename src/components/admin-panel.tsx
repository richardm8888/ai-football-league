'use client';

import { useActionState } from 'react';
import {
  advancePhaseAction, assignClubAction, openNextMatchdayAction, reopenMatchdayAction,
  simulateMatchdayAction, startSeasonAction, type AdminActionState,
} from '@/app/actions/admin';
import type { MatchdayPhase } from '@/domain/types';
import { SubmitButton } from './submit-button';
import { Alert, Badge, Card, CardTitle, Empty, humanise, inputClass } from './ui';

/**
 * League administration.
 *
 * Deliberately blunt and explicit: the destructive-feeling actions (simulating
 * without everyone locked in, reopening a matchday) say exactly what they will
 * do before you press them.
 */
export function AdminPanel({
  leagueId, inviteCode, matchday, lockStatus, clubs, members, hasSeason,
}: {
  leagueId: string;
  inviteCode: string;
  matchday: { id: string; number: number; phase: MatchdayPhase; played: boolean } | null;
  lockStatus: { locked: number; total: number; outstanding: Array<{ clubId: string; clubName: string }>; allLocked: boolean } | null;
  clubs: Array<{ id: string; name: string; ownerUserId: string | null }>;
  members: Array<{ userId: string; displayName: string }>;
  hasSeason: boolean;
}) {
  const [phaseState, phaseAction] = useActionState(advancePhaseAction, {} as AdminActionState);
  const [simState, simAction] = useActionState(simulateMatchdayAction, {} as AdminActionState);
  const [nextState, nextAction] = useActionState(openNextMatchdayAction, {} as AdminActionState);
  const [reopenState, reopenAction] = useActionState(reopenMatchdayAction, {} as AdminActionState);
  const [assignState, assignAction] = useActionState(assignClubAction, {} as AdminActionState);
  const [seasonState, seasonAction] = useActionState(startSeasonAction, {} as AdminActionState);

  const states = [phaseState, simState, nextState, reopenState, assignState, seasonState];
  const message = states.find((s) => s.message)?.message;
  const error = states.find((s) => s.error)?.error;

  return (
    <div className="space-y-4">
      {message && <Alert tone="good">{message}</Alert>}
      {error && <Alert tone="bad">{error}</Alert>}

      <Card>
        <CardTitle>Invite</CardTitle>
        <p className="font-mono text-2xl tracking-[0.25em] text-brand-400">{inviteCode}</p>
        <p className="mt-1 text-xs text-ink-500">
          Anyone with this code can join the league and take over an unclaimed club.
        </p>
      </Card>

      {!hasSeason && (
        <Card>
          <CardTitle>Season</CardTitle>
          <p className="mb-3 text-sm text-ink-300">
            No active season. Creating one builds the clubs, squads and the full fixture list.
          </p>
          <form action={seasonAction}>
            <input type="hidden" name="leagueId" value={leagueId} />
            <SubmitButton pendingLabel="Building…">Create the season</SubmitButton>
          </form>
        </Card>
      )}

      {matchday && (
        <Card>
          <CardTitle action={<Badge>{humanise(matchday.phase)}</Badge>}>
            Matchday {matchday.number}
          </CardTitle>

          {lockStatus && (
            <p className="mb-3 text-sm text-ink-300">
              {lockStatus.locked} of {lockStatus.total} clubs locked in.
              {lockStatus.outstanding.length > 0 && (
                <span className="block text-xs text-ink-500">
                  Waiting on {lockStatus.outstanding.map((c) => c.clubName).join(', ')}.
                </span>
              )}
            </p>
          )}

          <div className="space-y-2">
            {!matchday.played && matchday.phase !== 'LOCKED' && (
              <form action={phaseAction}>
                <input type="hidden" name="leagueId" value={leagueId} />
                <input type="hidden" name="matchdayId" value={matchday.id} />
                <SubmitButton tone="secondary" className="w-full">Advance to the next phase</SubmitButton>
              </form>
            )}

            {!matchday.played && (
              <form action={simAction} className="space-y-2">
                <input type="hidden" name="leagueId" value={leagueId} />
                <input type="hidden" name="matchdayId" value={matchday.id} />
                <SubmitButton className="w-full" pendingLabel="Playing the fixtures…">
                  Simulate this matchday
                </SubmitButton>
                {lockStatus && !lockStatus.allLocked && (
                  <label className="flex items-start gap-3 rounded-xl border border-warn-500/40 bg-warn-500/10 p-3 text-sm">
                    <input type="checkbox" name="force" value="1" className="mt-0.5 h-5 w-5 accent-[var(--color-warn-500)]" />
                    <span>
                      Play anyway without everyone locked in
                      <span className="mt-0.5 block text-xs text-ink-400">
                        Clubs that have not submitted will field the side their coaching staff would
                        pick by default.
                      </span>
                    </span>
                  </label>
                )}
              </form>
            )}

            {matchday.played && (
              <form action={nextAction}>
                <input type="hidden" name="leagueId" value={leagueId} />
                <input type="hidden" name="matchdayId" value={matchday.id} />
                <SubmitButton className="w-full">Close this week and open the next</SubmitButton>
              </form>
            )}

            {!matchday.played && (matchday.phase === 'LOCKED' || matchday.phase === 'REVIEW_AND_APPROVAL') && (
              <form action={reopenAction}>
                <input type="hidden" name="leagueId" value={leagueId} />
                <input type="hidden" name="matchdayId" value={matchday.id} />
                <SubmitButton tone="ghost" className="w-full">
                  Reopen so managers can edit again
                </SubmitButton>
              </form>
            )}
          </div>
        </Card>
      )}

      <Card>
        <CardTitle>Clubs</CardTitle>
        {clubs.length === 0 ? (
          <Empty>No clubs yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {clubs.map((club) => (
              <li key={club.id}>
                <form action={assignAction} className="flex items-center gap-2">
                  <input type="hidden" name="leagueId" value={leagueId} />
                  <input type="hidden" name="clubId" value={club.id} />
                  <span className="min-w-0 flex-1 truncate text-sm">{club.name}</span>
                  <select name="userId" defaultValue={club.ownerUserId ?? ''} className={`${inputClass} max-w-[10rem]`}>
                    <option value="">Unclaimed</option>
                    {members.map((member) => (
                      <option key={member.userId} value={member.userId}>{member.displayName}</option>
                    ))}
                  </select>
                  <SubmitButton tone="ghost">Set</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
