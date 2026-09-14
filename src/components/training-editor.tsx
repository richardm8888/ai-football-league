'use client';

import { useActionState, useMemo, useState } from 'react';
import { saveTrainingPlanAction, type PlanActionState } from '@/app/actions/plans';
import { INTENSITY_MULTIPLIER } from '@/domain/familiarity';
import type { TrainingPlanInput } from '@/domain/schemas';
import { FORMATION_LIST, getFormation } from '@/domain/tactics/formations';
import { ROLE_DEFINITIONS, rolesForPosition } from '@/domain/tactics/roles';
import { validateTrainingPlan } from '@/domain/validation';
import { TRAINING_FOCUSES, TRAINING_INTENSITIES } from '@/domain/types';
import type { Formation, PlayerRole, TrainingFocus, TrainingIntensity } from '@/domain/types';
import { Alert, Badge, Card, CardTitle, Empty, Field, humanise, inputClass, Meter } from './ui';

/**
 * The training screen.
 *
 * Training is a trade-off, so the screen states the trade-off rather than hiding
 * it: what each session improves, what it costs in fatigue, and what the current
 * intensity is doing to injury risk.
 */

const FOCUS_NOTES: Record<TrainingFocus, { improves: string; costs: string }> = {
  RECOVERY: { improves: 'Fitness and fatigue recovery', costs: 'No tactical progress, sharpness slips' },
  FITNESS: { improves: 'Stamina and conditioning', costs: 'Heavy legs, no tactical work' },
  POSSESSION: { improves: 'Build-up security and playing style', costs: 'Moderate load' },
  PRESSING: { improves: 'Pressing coordination and timing', costs: 'High fatigue, raised injury risk' },
  DEFENSIVE_ORGANISATION: { improves: 'Compactness and defensive shape', costs: 'Low load' },
  ATTACKING_PATTERNS: { improves: 'Playing style in the final third', costs: 'Moderate load' },
  TRANSITION_PLAY: { improves: 'Counter-attacks and defensive recovery', costs: 'High fatigue' },
  SET_PIECES: { improves: 'Set-piece delivery and movement', costs: 'Very low load' },
  FORMATION_FAMILIARITY: { improves: 'Shape familiarity, including one you have not played yet', costs: 'Low load' },
  INDIVIDUAL_ROLES: { improves: 'Named players in specific roles', costs: 'Less team-wide preparation' },
  MATCH_PREPARATION: { improves: 'Match sharpness and this week’s shape', costs: 'Low load' },
};

export interface TrainingPlayer {
  id: string;
  name: string;
  primaryPosition: string;
  secondaryPositions: string[];
  fitness: number;
  injured: boolean;
  injuryDescription: string | null;
  suspended: boolean;
}

export function TrainingEditor({
  clubId, matchdayId, editable, initialPlan, players, status, currentFormation, familiarity,
}: {
  clubId: string;
  matchdayId: string;
  editable: boolean;
  initialPlan: TrainingPlanInput;
  players: TrainingPlayer[];
  status: string;
  currentFormation: Formation;
  familiarity: { pressing: number; buildUp: number; defensiveOrganisation: number; transition: number; setPieces: number; formation: number };
}) {
  const [plan, setPlan] = useState<TrainingPlanInput>(initialPlan);
  const [state, action] = useActionState(saveTrainingPlanAction, {} as PlanActionState);

  const validation = useMemo(
    () => validateTrainingPlan(plan, players.map((p) => ({
      id: p.id, name: p.name,
      primaryPosition: p.primaryPosition as never,
      secondaryPositions: p.secondaryPositions as never,
      fitness: Math.round(p.fitness), injured: p.injured,
      injuryDescription: p.injuryDescription, suspended: p.suspended,
    }))),
    [plan, players]);

  const availableFitness = players.filter((p) => !p.injured);
  const averageFitness = availableFitness.length > 0
    ? Math.round(availableFitness.reduce((a, p) => a + p.fitness, 0) / availableFitness.length)
    : 0;
  const load = INTENSITY_MULTIPLIER[plan.intensity];

  const set = <K extends keyof TrainingPlanInput>(key: K, value: TrainingPlanInput[K]) =>
    setPlan({ ...plan, [key]: value });

  return (
    <div className="space-y-4 pb-4">
      {state.message && <Alert tone="good">{state.message}</Alert>}
      {state.error && (
        <Alert tone="bad" title={state.error}>
          {state.validation?.errors.map((issue, i) => <p key={i}>{issue.message}</p>)}
        </Alert>
      )}
      {!editable && (
        <Alert tone="warn" title="Training is closed for this matchday">
          The week has moved on. Training opens again with the next matchday.
        </Alert>
      )}

      <Card>
        <CardTitle action={<Badge tone={status === 'APPROVED' ? 'good' : 'warn'}>{humanise(status)}</Badge>}>
          This week on the training ground
        </CardTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Primary focus" hint={FOCUS_NOTES[plan.primaryFocus].improves}>
            <select
              className={inputClass} value={plan.primaryFocus} disabled={!editable}
              onChange={(e) => set('primaryFocus', e.target.value as TrainingFocus)}
            >
              {TRAINING_FOCUSES.map((focus) => (
                <option key={focus} value={focus}>{humanise(focus)}</option>
              ))}
            </select>
          </Field>
          <Field label="Secondary focus" hint={FOCUS_NOTES[plan.secondaryFocus].improves}>
            <select
              className={inputClass} value={plan.secondaryFocus} disabled={!editable}
              onChange={(e) => set('secondaryFocus', e.target.value as TrainingFocus)}
            >
              {TRAINING_FOCUSES.filter((f) => f !== plan.primaryFocus).map((focus) => (
                <option key={focus} value={focus}>{humanise(focus)}</option>
              ))}
            </select>
          </Field>
          <Field label="Intensity" hint={`Tactical gains scale by ${load.toFixed(2)}×. Higher intensity means more fatigue and more injuries.`}>
            <select
              className={inputClass} value={plan.intensity} disabled={!editable}
              onChange={(e) => set('intensity', e.target.value as TrainingIntensity)}
            >
              {TRAINING_INTENSITIES.map((intensity) => (
                <option key={intensity} value={intensity}>{humanise(intensity)}</option>
              ))}
            </select>
          </Field>
          {(plan.primaryFocus === 'FORMATION_FAMILIARITY' || plan.secondaryFocus === 'FORMATION_FAMILIARITY') && (
            <Field
              label="Shape to rehearse"
              hint="Naming a shape you are not yet playing is how you phase a change in gradually, at far lower cost than switching on matchday."
            >
              <select
                className={inputClass} value={plan.targetFormation ?? currentFormation} disabled={!editable}
                onChange={(e) => set('targetFormation', e.target.value as Formation)}
              >
                {FORMATION_LIST.map((f) => (
                  <option key={f.formation} value={f.formation}>
                    {f.label}{f.formation === currentFormation ? ' (playing this week)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <TradeOff focus={plan.primaryFocus} weight="Primary" />
          <TradeOff focus={plan.secondaryFocus} weight="Secondary" />
        </div>
      </Card>

      <Card>
        <CardTitle>Where the gap is</CardTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Meter label={`${getFormation(currentFormation).label} shape`} value={familiarity.formation} />
          <Meter label="Pressing" value={familiarity.pressing} />
          <Meter label="Build-up" value={familiarity.buildUp} />
          <Meter label="Defensive organisation" value={familiarity.defensiveOrganisation} />
          <Meter label="Transitions" value={familiarity.transition} />
          <Meter label="Set pieces" value={familiarity.setPieces} />
        </div>
        <p className="mt-3 text-xs text-ink-500">
          Squad fitness averages {averageFitness}%. Training the lowest relevant bar buys the most
          improvement, but only if the legs can take the load.
        </p>
      </Card>

      <Card>
        <CardTitle action={
          <button
            type="button"
            disabled={!editable || plan.individualFocus.length >= 4}
            onClick={() => {
              const candidate = players.find((p) => !p.injured
                && !plan.individualFocus.some((f) => f.playerId === p.id));
              if (!candidate) return;
              const role = rolesForPosition(candidate.primaryPosition as never)[0]?.role
                ?? 'CENTRAL_MIDFIELDER';
              set('individualFocus', [...plan.individualFocus, { playerId: candidate.id, role }]);
            }}
            className="text-xs text-brand-400 underline underline-offset-4 disabled:opacity-40"
          >
            Add
          </button>
        }
        >
          Individual sessions ({plan.individualFocus.length} of 4)
        </CardTitle>
        {plan.individualFocus.length === 0 ? (
          <Empty>No individual work. Every session goes to the team as a whole.</Empty>
        ) : (
          <ul className="space-y-3">
            {plan.individualFocus.map((focus, index) => {
              const player = players.find((p) => p.id === focus.playerId);
              const roles = player ? rolesForPosition(player.primaryPosition as never) : [];
              return (
                <li key={index} className="rounded-xl border border-line-700 bg-pitch-850 p-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Field label="Player">
                      <select
                        className={inputClass} value={focus.playerId} disabled={!editable}
                        onChange={(e) => set('individualFocus', plan.individualFocus.map((f, i) => (
                          i === index ? { ...f, playerId: e.target.value } : f)))}
                      >
                        {players.filter((p) => !p.injured).map((p) => (
                          <option key={p.id} value={p.id}>{p.name} ({p.primaryPosition})</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Role to drill" hint={ROLE_DEFINITIONS[focus.role]?.description}>
                      <select
                        className={inputClass} value={focus.role} disabled={!editable}
                        onChange={(e) => set('individualFocus', plan.individualFocus.map((f, i) => (
                          i === index ? { ...f, role: e.target.value as PlayerRole } : f)))}
                      >
                        {(roles.length > 0 ? roles : Object.values(ROLE_DEFINITIONS)).map((role) => (
                          <option key={role.role} value={role.role}>{role.label}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <button
                    type="button" disabled={!editable}
                    onClick={() => set('individualFocus', plan.individualFocus.filter((_, i) => i !== index))}
                    className="mt-2 text-xs text-danger-400 underline underline-offset-4 disabled:opacity-40"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {validation.warnings.length > 0 && (
        <Alert tone="warn" title="Worth knowing">
          <ul className="list-disc space-y-1 pl-4">
            {validation.warnings.map((issue, i) => <li key={i}>{issue.message}</li>)}
          </ul>
        </Alert>
      )}
      {validation.errors.length > 0 && (
        <Alert tone="bad" title="Must be fixed">
          <ul className="list-disc space-y-1 pl-4">
            {validation.errors.map((issue, i) => <li key={i}>{issue.message}</li>)}
          </ul>
        </Alert>
      )}

      <form action={action} className="sticky bottom-[4.75rem] z-20 -mx-4 flex gap-2 border-t border-line-700/60 bg-pitch-950/95 px-4 py-3 backdrop-blur">
        <input type="hidden" name="clubId" value={clubId} />
        <input type="hidden" name="matchdayId" value={matchdayId} />
        <input type="hidden" name="plan" value={JSON.stringify(plan)} />
        <button
          type="submit" disabled={!editable || !validation.ok}
          className="min-h-11 flex-1 rounded-xl border border-line-700 bg-pitch-800 px-4 disabled:opacity-40"
        >
          Save draft
        </button>
        <button
          type="submit" name="approve" value="1" disabled={!editable || !validation.ok}
          className="min-h-11 flex-1 rounded-xl bg-brand-600 px-4 font-semibold text-pitch-950 disabled:opacity-40"
        >
          Approve training
        </button>
      </form>
    </div>
  );
}

function TradeOff({ focus, weight }: { focus: TrainingFocus; weight: string }) {
  const note = FOCUS_NOTES[focus];
  return (
    <div className="rounded-xl border border-line-700 bg-pitch-850 p-3">
      <p className="text-[11px] uppercase tracking-wide text-ink-500">{weight}</p>
      <p className="mt-1 text-sm font-medium">{humanise(focus)}</p>
      <p className="mt-1 text-xs text-brand-400">Improves: {note.improves}</p>
      <p className="mt-0.5 text-xs text-warn-400">Costs: {note.costs}</p>
    </div>
  );
}
