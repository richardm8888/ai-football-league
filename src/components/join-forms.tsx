'use client';

import { useActionState } from 'react';
import { createLeagueAction, joinLeagueAction, type ActionState } from '@/app/actions/auth';
import { SubmitButton } from './submit-button';
import { Alert, Card, CardTitle, Field, inputClass } from './ui';

export function JoinForms() {
  const [joinState, joinFormAction] = useActionState(joinLeagueAction, {} as ActionState);
  const [createState, createFormAction] = useActionState(createLeagueAction, {} as ActionState);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Join with an invite code</CardTitle>
        <form action={joinFormAction} className="space-y-3">
          {joinState.error && <Alert tone="bad">{joinState.error}</Alert>}
          <Field label="Invite code" htmlFor="inviteCode">
            <input
              id="inviteCode"
              name="inviteCode"
              required
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className={`${inputClass} tracking-[0.2em] uppercase`}
              placeholder="ABCD2345"
            />
          </Field>
          <SubmitButton className="w-full">Join league</SubmitButton>
        </form>
      </Card>

      <Card>
        <CardTitle>Start a new league</CardTitle>
        <form action={createFormAction} className="space-y-3">
          {createState.error && <Alert tone="bad">{createState.error}</Alert>}
          <Field label="League name" htmlFor="name">
            <input id="name" name="name" required className={inputClass} placeholder="The Sunday Circle" />
          </Field>
          <label className="flex items-start gap-3 rounded-xl border border-line-700 bg-pitch-850 p-3">
            <input type="checkbox" name="startSeason" defaultChecked className="mt-1 h-5 w-5 accent-[var(--color-brand-500)]" />
            <span className="text-sm text-ink-200">
              Build the season now
              <span className="mt-0.5 block text-xs text-ink-500">
                Creates eight fictional clubs with full squads and a double round-robin fixture list. You can invite the rest later.
              </span>
            </span>
          </label>
          <SubmitButton tone="secondary" className="w-full" pendingLabel="Building the season…">
            Create league
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
