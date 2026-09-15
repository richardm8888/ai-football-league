'use client';

import { useActionState } from 'react';
import { claimClubAction, type ClaimActionState } from '@/app/actions/clubs';
import type { ClubChoice } from '@/services/league';
import { SubmitButton } from './submit-button';
import { Alert, Badge, Card } from './ui';

/**
 * Picking a club to manage.
 *
 * Every club in the league is shown, taken ones included, because which of them
 * are already spoken for is part of the decision. What is shown about each club
 * is only what every manager can see anyway: what it is known for, how well
 * thought of it is, and how it is doing.
 */
export function ClubChooser({ leagueId, choices }: { leagueId: string; choices: ClubChoice[] }) {
  const [state, action] = useActionState(claimClubAction, {} as ClaimActionState);

  return (
    <div className="space-y-3">
      {state.message && <Alert tone="good">{state.message}</Alert>}
      {state.error && <Alert tone="bad">{state.error}</Alert>}

      {choices.map((club) => (
        <Card key={club.id}>
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 h-9 w-9 shrink-0 rounded-lg border border-white/15"
              style={{ background: club.primaryColor }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{club.name}</h2>
                {club.available
                  ? <Badge tone="good">Available</Badge>
                  : <Badge tone="neutral">Taken</Badge>}
              </div>
              {club.nickname && (
                <p className="text-xs text-ink-500">
                  {club.nickname}{club.stadium ? ` · ${club.stadium}` : ''}
                </p>
              )}

              {club.identity && <p className="mt-2 text-sm text-ink-300">{club.identity}</p>}

              <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-400">
                <div className="flex gap-1">
                  <dt>Reputation</dt>
                  <dd className="font-semibold text-ink-200">{club.reputation}</dd>
                </div>
                {club.position !== null && (
                  <div className="flex gap-1">
                    <dt>Position</dt>
                    <dd className="font-semibold text-ink-200">{club.position}</dd>
                  </div>
                )}
                {club.played > 0 && (
                  <>
                    <div className="flex gap-1">
                      <dt>Played</dt>
                      <dd className="font-semibold text-ink-200">{club.played}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>Points</dt>
                      <dd className="font-semibold text-ink-200">{club.points}</dd>
                    </div>
                  </>
                )}
                {club.formGuide && (
                  <div className="flex gap-1">
                    <dt>Form</dt>
                    <dd className="font-mono font-semibold text-ink-200">{club.formGuide}</dd>
                  </div>
                )}
              </dl>

              {club.available && (
                <form action={action} className="mt-3">
                  <input type="hidden" name="leagueId" value={leagueId} />
                  <input type="hidden" name="clubId" value={club.id} />
                  <SubmitButton pendingLabel="Taking charge…">Manage {club.name}</SubmitButton>
                </form>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
