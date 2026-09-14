'use client';

import { useActionState, useMemo, useState } from 'react';
import { lockMatchPlanAction, saveMatchPlanAction, type PlanActionState } from '@/app/actions/plans';
import { analyseTacticalChange } from '@/domain/familiarity';
import type { LineupSelectionInput, TacticalPlanInput } from '@/domain/schemas';
import { MATCH_STATE_ADJUSTMENTS, MATCH_STATE_TRIGGERS } from '@/domain/schemas';
import { getFormation, FORMATION_LIST } from '@/domain/tactics/formations';
import { ROLE_DEFINITIONS, rolesForPosition } from '@/domain/tactics/roles';
import { autoSelectLineup, bestRoleForSlot, defaultSubstitutionPlan, type SelectablePlayer } from '@/domain/tactics/selection';
import { positionSuitability, suitabilityBand } from '@/domain/tactics/suitability';
import { validateMatchPlan, type ValidationIssue } from '@/domain/validation';
import {
  ATTACKING_FOCUSES, BUILD_UPS, DEFENSIVE_APPROACHES, DEFENSIVE_LINES, MENTALITIES,
  PLAYING_STYLES, PRESSING_INTENSITIES, RISK_TOLERANCES, SET_PIECE_APPROACHES, TEMPOS, WIDTHS,
} from '@/domain/types';
import type { Formation, PlayerRole } from '@/domain/types';
import { Pitch } from './pitch';
import { Alert, Badge, Card, CardTitle, ChipRow, Empty, Field, humanise, inputClass, Meter } from './ui';
import type { EditorPlayer, TacticsEditorProps } from './tactics-editor-types';

/**
 * The tactics and selection screen.
 *
 * Everything a manager submits passes through here, and the same pure domain
 * code that the server validates with runs in the browser, so warnings about
 * unfamiliar systems, out-of-position players and tactical change costs appear
 * as the manager edits rather than after they submit.
 *
 * The server revalidates on save regardless: this is for feedback, not trust.
 */

type Tab = 'shape' | 'instructions' | 'bench' | 'review';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'shape', label: 'Shape' },
  { id: 'instructions', label: 'Instructions' },
  { id: 'bench', label: 'Bench' },
  { id: 'review', label: 'Review' },
];

export function TacticsEditor(props: TacticsEditorProps) {
  const [tactics, setTactics] = useState<TacticalPlanInput>(props.initialTactics);
  const [lineup, setLineup] = useState<LineupSelectionInput>(props.initialLineup);
  const [tab, setTab] = useState<Tab>('shape');
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [saveState, saveAction] = useActionState(saveMatchPlanAction, {} as PlanActionState);
  const [lockState, lockAction] = useActionState(lockMatchPlanAction, {} as PlanActionState);

  const playersById = useMemo(
    () => new Map(props.players.map((p) => [p.id, p])), [props.players]);

  const selectable: SelectablePlayer[] = useMemo(() => props.players.map((p) => ({
    id: p.id, name: p.name, primaryPosition: p.primaryPosition,
    secondaryPositions: p.secondaryPositions, attributes: p.attributes,
    fitness: p.fitness, form: p.form, injured: p.injured, suspended: p.suspended,
  })), [props.players]);

  const validation = useMemo(
    () => validateMatchPlan(
      { tactics, lineup, notes: '' },
      props.players.map((p) => ({
        id: p.id, name: p.name, primaryPosition: p.primaryPosition,
        secondaryPositions: p.secondaryPositions, fitness: Math.round(p.fitness),
        injured: p.injured, injuryDescription: p.injuryDescription, suspended: p.suspended,
      }))),
    [tactics, lineup, props.players]);

  const analysis = useMemo(
    () => analyseTacticalChange(tactics, props.familiarity, props.previousPlan),
    [tactics, props.familiarity, props.previousPlan]);

  const disabled = !props.editable;

  function setFormation(formation: Formation) {
    // Re-seat the side into the new shape by suitability, then keep as much of
    // the existing bench as is still available. Planned substitutions are
    // cleared because they referenced the old eleven.
    const reseated = autoSelectLineup(selectable, formation);
    const starting = new Set(reseated.starters.map((s) => s.playerId));
    const bench = lineup.bench
      .filter((b) => !starting.has(b.playerId))
      .map((b, i) => ({ playerId: b.playerId, order: i }));
    setTactics({ ...tactics, formation, substitutionPlan: [] });
    setLineup({
      ...reseated,
      bench: bench.length > 0 ? bench : reseated.bench,
      captainPlayerId: starting.has(lineup.captainPlayerId ?? '')
        ? lineup.captainPlayerId
        : reseated.captainPlayerId,
    });
  }

  function assignPlayer(slot: string, playerId: string) {
    const existing = lineup.starters.find((s) => s.playerId === playerId);
    const target = lineup.starters.find((s) => s.slot === slot);
    const player = playersById.get(playerId);
    if (!player) return;

    let starters = lineup.starters;
    if (existing) {
      // Swap two players who are both already in the side.
      starters = starters.map((s) => {
        if (s.slot === slot) return { ...s, playerId, role: bestRoleForSlot(toSelectable(player), tactics.formation, slot) };
        if (s.slot === existing.slot && target) {
          const other = playersById.get(target.playerId);
          return {
            ...s,
            playerId: target.playerId,
            role: other ? bestRoleForSlot(toSelectable(other), tactics.formation, existing.slot) : s.role,
          };
        }
        return s;
      });
    } else {
      starters = starters.map((s) => (s.slot === slot
        ? { ...s, playerId, role: bestRoleForSlot(toSelectable(player), tactics.formation, slot) }
        : s));
    }
    setLineup({
      ...lineup,
      starters,
      bench: lineup.bench.filter((b) => b.playerId !== playerId),
    });
    setOpenSlot(null);
  }

  function setRole(slot: string, role: PlayerRole) {
    setLineup({
      ...lineup,
      starters: lineup.starters.map((s) => (s.slot === slot ? { ...s, role } : s)),
    });
  }

  function toggleBench(playerId: string) {
    const onBench = lineup.bench.some((b) => b.playerId === playerId);
    if (onBench) {
      setLineup({
        ...lineup,
        bench: lineup.bench.filter((b) => b.playerId !== playerId).map((b, i) => ({ ...b, order: i })),
      });
    } else if (lineup.bench.length < 7 && !lineup.starters.some((s) => s.playerId === playerId)) {
      setLineup({ ...lineup, bench: [...lineup.bench, { playerId, order: lineup.bench.length }] });
    }
  }

  function autoPick() {
    const picked = autoSelectLineup(selectable, tactics.formation);
    setLineup(picked);
    setTactics({ ...tactics, substitutionPlan: defaultSubstitutionPlan(picked, selectable, tactics.formation) });
  }

  const planJson = JSON.stringify({ tactics, lineup, notes: '' });
  const message = saveState.message ?? lockState.message;
  const error = saveState.error ?? lockState.error;
  const serverIssues = [
    ...(saveState.validation?.errors ?? []),
    ...(lockState.validation?.errors ?? []),
  ];

  // A locked or closed plan is not the manager's problem to fix; the warnings
  // below only apply while they can still act on them.
  const showValidation = props.editable;

  return (
    <div className="space-y-4 pb-4">
      {props.planStatus === 'LOCKED' && (
        <Alert tone="good" title="Locked in">
          Your plan is frozen for matchday. An administrator can reopen the matchday if something needs to change.
        </Alert>
      )}
      {disabled && props.planStatus !== 'LOCKED' && (
        <Alert tone="warn" title="Plans are closed">
          This matchday has moved past the point where plans can be edited.
        </Alert>
      )}
      {message && <Alert tone="good">{message}</Alert>}
      {error && (
        <Alert tone="bad" title={error}>
          {serverIssues.length > 0 && (
            <ul className="list-disc pl-4">
              {serverIssues.map((issue, i) => <li key={i}>{issue.message}</li>)}
            </ul>
          )}
        </Alert>
      )}

      <ChipRow>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-pressed={tab === item.id}
            className={`min-h-11 whitespace-nowrap rounded-full border px-4 text-sm font-medium ${
              tab === item.id
                ? 'border-brand-500 bg-brand-600/20 text-brand-400'
                : 'border-line-700 bg-pitch-900 text-ink-300'
            }`}
          >
            {item.label}
            {item.id === 'review' && (validation.errors.length > 0 || analysis.magnitude === 'MAJOR') && (
              <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-danger-400 align-middle" />
            )}
          </button>
        ))}
      </ChipRow>

      {tab === 'shape' && (
        <div className="space-y-4">
          <Card>
            <CardTitle action={
              <button type="button" onClick={autoPick} disabled={disabled} className="text-xs text-brand-400 underline underline-offset-4 disabled:opacity-40">
                Pick a side for me
              </button>
            }
            >
              Formation
            </CardTitle>
            <ChipRow>
              {FORMATION_LIST.map((f) => {
                const value = Math.round(props.familiarity.FORMATION[f.formation] ?? 30);
                const active = tactics.formation === f.formation;
                return (
                  <button
                    key={f.formation}
                    type="button"
                    disabled={disabled}
                    onClick={() => setFormation(f.formation)}
                    aria-pressed={active}
                    className={`min-h-14 whitespace-nowrap rounded-xl border px-4 text-left disabled:opacity-40 ${
                      active ? 'border-brand-500 bg-brand-600/15' : 'border-line-700 bg-pitch-900'
                    }`}
                  >
                    <span className="block text-sm font-semibold">{f.label}</span>
                    <span className={`block text-[11px] ${value >= 60 ? 'text-brand-400' : value >= 40 ? 'text-warn-400' : 'text-danger-400'}`}>
                      {value}% familiar
                    </span>
                  </button>
                );
              })}
            </ChipRow>
            <p className="mt-3 text-xs text-ink-500">{getFormation(tactics.formation).description}</p>
          </Card>

          <Pitch
            formation={tactics.formation}
            assignments={lineup.starters}
            players={playersById}
            selectedSlot={openSlot}
            onSelectSlot={(slot) => setOpenSlot(openSlot === slot ? null : slot)}
          />

          {openSlot && (
            <SlotSheet
              slot={openSlot}
              formation={tactics.formation}
              lineup={lineup}
              players={props.players}
              disabled={disabled}
              onAssign={assignPlayer}
              onRole={setRole}
              onClose={() => setOpenSlot(null)}
            />
          )}
        </div>
      )}

      {tab === 'instructions' && (
        <InstructionsTab tactics={tactics} setTactics={setTactics} disabled={disabled} />
      )}

      {tab === 'bench' && (
        <BenchTab
          lineup={lineup}
          tactics={tactics}
          setTactics={setTactics}
          players={props.players}
          disabled={disabled}
          onToggle={toggleBench}
        />
      )}

      {tab === 'review' && (
        <ReviewTab
          validation={showValidation ? validation : { ok: true, errors: [], warnings: [] }}
          analysis={analysis}
          tactics={tactics}
          familiarity={props.familiarity}
        />
      )}

      {/* Submission. Approving and locking are separate deliberate steps. */}
      <div className="sticky bottom-[4.75rem] z-20 -mx-4 border-t border-line-700/60 bg-pitch-950/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap gap-2">
          <form action={saveAction} className="flex-1">
            <input type="hidden" name="fixtureId" value={props.fixtureId} />
            <input type="hidden" name="clubId" value={props.clubId} />
            <input type="hidden" name="plan" value={planJson} />
            <SaveButtons disabled={disabled || !validation.ok} />
          </form>
          <form action={lockAction}>
            <input type="hidden" name="fixtureId" value={props.fixtureId} />
            <input type="hidden" name="clubId" value={props.clubId} />
            <button
              type="submit"
              disabled={!props.lockable || props.planStatus === 'LOCKED' || !validation.ok}
              className="min-h-11 rounded-xl bg-brand-600 px-4 font-semibold text-pitch-950 disabled:opacity-40"
            >
              {props.planStatus === 'LOCKED' ? 'Locked' : 'Lock in'}
            </button>
          </form>
        </div>
        {showValidation && !validation.ok && (
          <p className="mt-2 text-xs text-danger-400">
            {validation.errors.length} problem{validation.errors.length === 1 ? '' : 's'} to fix before submitting. See Review.
          </p>
        )}
      </div>
    </div>
  );
}

function SaveButtons({ disabled }: { disabled: boolean }) {
  return (
    <div className="flex gap-2">
      <button
        type="submit"
        disabled={disabled}
        className="min-h-11 flex-1 rounded-xl border border-line-700 bg-pitch-800 px-4 text-ink-50 disabled:opacity-40"
      >
        Save draft
      </button>
      <button
        type="submit"
        name="approve"
        value="1"
        disabled={disabled}
        className="min-h-11 flex-1 rounded-xl border border-brand-600/50 bg-brand-600/20 px-4 font-semibold text-brand-400 disabled:opacity-40"
      >
        Approve
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slot selection sheet
// ---------------------------------------------------------------------------

function SlotSheet({
  slot, formation, lineup, players, disabled, onAssign, onRole, onClose,
}: {
  slot: string;
  formation: Formation;
  lineup: LineupSelectionInput;
  players: EditorPlayer[];
  disabled: boolean;
  onAssign: (slot: string, playerId: string) => void;
  onRole: (slot: string, role: PlayerRole) => void;
  onClose: () => void;
}) {
  const definition = getFormation(formation).slots.find((s) => s.key === slot);
  const assignment = lineup.starters.find((s) => s.slot === slot);
  if (!definition) return null;

  const candidates = [...players]
    .filter((p) => !p.injured && !p.suspended)
    .sort((a, b) =>
      positionSuitability(b, definition.position) * b.overall
      - positionSuitability(a, definition.position) * a.overall);

  const roles = rolesForPosition(definition.position);

  return (
    <Card>
      <CardTitle action={
        <button type="button" onClick={onClose} className="text-xs text-ink-400 underline underline-offset-4">Close</button>
      }
      >
        {definition.label} · {definition.position}
      </CardTitle>

      {assignment && (
        <div className="mb-3">
          <Field label="Role" hint={ROLE_DEFINITIONS[assignment.role]?.description}>
            <select
              className={inputClass}
              value={assignment.role}
              disabled={disabled}
              onChange={(e) => onRole(slot, e.target.value as PlayerRole)}
            >
              {roles.map((role) => (
                <option key={role.role} value={role.role}>{role.label}</option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <p className="mb-2 text-xs uppercase tracking-wide text-ink-500">Choose a player</p>
      <ul className="max-h-80 space-y-1.5 overflow-y-auto">
        {candidates.map((player) => {
          const suitability = positionSuitability(player, definition.position);
          const band = suitabilityBand(suitability);
          const starting = lineup.starters.some((s) => s.playerId === player.id);
          const current = assignment?.playerId === player.id;
          return (
            <li key={player.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onAssign(slot, player.id)}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left disabled:opacity-40 ${
                  current ? 'border-brand-500 bg-brand-600/15' : 'border-line-700 bg-pitch-850'
                }`}
              >
                <span className="w-7 shrink-0 text-center text-xs font-bold tabular-nums text-ink-400">
                  {player.shirtNumber}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{player.name}</span>
                  <span className="block text-[11px] text-ink-500">
                    {player.primaryPosition} · fit {Math.round(player.fitness)}% · form {Math.round(player.form)}
                    {starting && !current ? ' · currently starting elsewhere' : ''}
                  </span>
                </span>
                <Badge tone={band === 'NATURAL' ? 'good' : band === 'ACCOMPLISHED' ? 'info' : band === 'AWKWARD' ? 'warn' : 'bad'}>
                  {band === 'NATURAL' ? 'Natural' : band === 'ACCOMPLISHED' ? 'Capable' : band === 'AWKWARD' ? 'Awkward' : 'Makeshift'}
                </Badge>
                <span className="w-8 shrink-0 text-right text-sm font-bold tabular-nums">{player.overall}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

function Choice<T extends string>({
  label, hint, value, options, disabled, onChange,
}: {
  label: string; hint?: string; value: T; options: readonly T[];
  disabled: boolean; onChange: (value: T) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <select
        className={inputClass}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((option) => (
          <option key={option} value={option}>{humanise(option)}</option>
        ))}
      </select>
    </Field>
  );
}

function Toggle({
  label, hint, checked, disabled, onChange,
}: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-line-700 bg-pitch-850 p-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-6 w-6 shrink-0 accent-[var(--color-brand-500)]"
      />
      <span className="text-sm">
        <span className="block font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-ink-500">{hint}</span>
      </span>
    </label>
  );
}

function InstructionsTab({
  tactics, setTactics, disabled,
}: { tactics: TacticalPlanInput; setTactics: (t: TacticalPlanInput) => void; disabled: boolean }) {
  const set = <K extends keyof TacticalPlanInput>(key: K, value: TacticalPlanInput[K]) =>
    setTactics({ ...tactics, [key]: value });

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>How we play</CardTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Choice label="Mentality" value={tactics.mentality} options={MENTALITIES} disabled={disabled} onChange={(v) => set('mentality', v)} />
          <Choice label="Playing style" value={tactics.playingStyle} options={PLAYING_STYLES} disabled={disabled} onChange={(v) => set('playingStyle', v)} />
          <Choice label="Build-up" value={tactics.buildUp} options={BUILD_UPS} disabled={disabled} onChange={(v) => set('buildUp', v)} />
          <Choice label="Tempo" value={tactics.tempo} options={TEMPOS} disabled={disabled} onChange={(v) => set('tempo', v)} />
          <Choice label="Width" value={tactics.width} options={WIDTHS} disabled={disabled} onChange={(v) => set('width', v)} />
          <Choice label="Attacking focus" value={tactics.attackingFocus} options={ATTACKING_FOCUSES} disabled={disabled} onChange={(v) => set('attackingFocus', v)} />
          <Choice label="Risk tolerance" value={tactics.riskTolerance} options={RISK_TOLERANCES} disabled={disabled} onChange={(v) => set('riskTolerance', v)} />
          <Choice label="Set pieces" value={tactics.setPieceApproach} options={SET_PIECE_APPROACHES} disabled={disabled} onChange={(v) => set('setPieceApproach', v)} />
        </div>
      </Card>

      <Card>
        <CardTitle>Out of possession</CardTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Choice label="Pressing intensity" value={tactics.pressing} options={PRESSING_INTENSITIES} disabled={disabled} onChange={(v) => set('pressing', v)} />
          <Choice label="Defensive line" value={tactics.defensiveLine} options={DEFENSIVE_LINES} disabled={disabled} onChange={(v) => set('defensiveLine', v)} />
          <Choice label="Defensive approach" value={tactics.defensiveApproach} options={DEFENSIVE_APPROACHES} disabled={disabled} onChange={(v) => set('defensiveApproach', v)} />
          <Field label={`Full-back freedom: ${tactics.fullBackFreedom}`} hint="0 keeps them home, 100 sends them forward at every opportunity.">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={tactics.fullBackFreedom}
              disabled={disabled}
              onChange={(e) => set('fullBackFreedom', Number(e.target.value))}
              className="h-11 w-full accent-[var(--color-brand-500)]"
            />
          </Field>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Toggle label="Counter-press" hint="Swarm the ball immediately after losing it." checked={tactics.counterPress} disabled={disabled} onChange={(v) => set('counterPress', v)} />
          <Toggle label="Counter-attack" hint="Break at pace the moment possession is won." checked={tactics.counterAttack} disabled={disabled} onChange={(v) => set('counterAttack', v)} />
          <Toggle label="Offside trap" hint="Step up together. Devastating when drilled, costly when not." checked={tactics.offsideTrap} disabled={disabled} onChange={(v) => set('offsideTrap', v)} />
        </div>
      </Card>

      <Card>
        <CardTitle action={
          <button
            type="button"
            disabled={disabled || tactics.matchStateInstructions.length >= 6}
            onClick={() => setTactics({
              ...tactics,
              matchStateInstructions: [...tactics.matchStateInstructions,
                { trigger: 'TRAILING', adjustment: 'MORE_ATTACKING', fromMinute: 60, note: '' }],
            })}
            className="text-xs text-brand-400 underline underline-offset-4 disabled:opacity-40"
          >
            Add
          </button>
        }
        >
          If the game changes
        </CardTitle>
        {tactics.matchStateInstructions.length === 0 ? (
          <Empty>No in-match instructions. The side will play the same way for ninety minutes.</Empty>
        ) : (
          <ul className="space-y-3">
            {tactics.matchStateInstructions.map((instruction, index) => (
              <li key={index} className="rounded-xl border border-line-700 bg-pitch-850 p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Choice
                    label="When" value={instruction.trigger} options={MATCH_STATE_TRIGGERS} disabled={disabled}
                    onChange={(v) => setTactics({
                      ...tactics,
                      matchStateInstructions: tactics.matchStateInstructions.map((x, i) => (i === index ? { ...x, trigger: v } : x)),
                    })}
                  />
                  <Choice
                    label="Then" value={instruction.adjustment} options={MATCH_STATE_ADJUSTMENTS} disabled={disabled}
                    onChange={(v) => setTactics({
                      ...tactics,
                      matchStateInstructions: tactics.matchStateInstructions.map((x, i) => (i === index ? { ...x, adjustment: v } : x)),
                    })}
                  />
                  <Field label={`Not before ${instruction.fromMinute}′`}>
                    <input
                      type="range" min={0} max={85} step={5} value={instruction.fromMinute} disabled={disabled}
                      className="h-11 w-full accent-[var(--color-brand-500)]"
                      onChange={(e) => setTactics({
                        ...tactics,
                        matchStateInstructions: tactics.matchStateInstructions.map((x, i) => (i === index ? { ...x, fromMinute: Number(e.target.value) } : x)),
                      })}
                    />
                  </Field>
                </div>
                <button
                  type="button" disabled={disabled}
                  onClick={() => setTactics({
                    ...tactics,
                    matchStateInstructions: tactics.matchStateInstructions.filter((_, i) => i !== index),
                  })}
                  className="mt-2 text-xs text-danger-400 underline underline-offset-4 disabled:opacity-40"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bench and substitutions
// ---------------------------------------------------------------------------

function BenchTab({
  lineup, tactics, setTactics, players, disabled, onToggle,
}: {
  lineup: LineupSelectionInput;
  tactics: TacticalPlanInput;
  setTactics: (t: TacticalPlanInput) => void;
  players: EditorPlayer[];
  disabled: boolean;
  onToggle: (playerId: string) => void;
}) {
  const starters = new Set(lineup.starters.map((s) => s.playerId));
  const benchIds = new Set(lineup.bench.map((b) => b.playerId));
  const byId = new Map(players.map((p) => [p.id, p]));

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Substitutes ({lineup.bench.length} of 7)</CardTitle>
        <ul className="space-y-1.5">
          {players
            .filter((p) => !starters.has(p.id))
            .sort((a, b) => Number(benchIds.has(b.id)) - Number(benchIds.has(a.id)) || b.overall - a.overall)
            .map((player) => {
              const on = benchIds.has(player.id);
              const unavailable = player.injured || player.suspended;
              return (
                <li key={player.id}>
                  <button
                    type="button"
                    disabled={disabled || unavailable}
                    onClick={() => onToggle(player.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left disabled:opacity-40 ${
                      on ? 'border-brand-500 bg-brand-600/15' : 'border-line-700 bg-pitch-850'
                    }`}
                  >
                    <span className="w-7 shrink-0 text-center text-xs font-bold tabular-nums text-ink-400">{player.shirtNumber}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{player.name}</span>
                      <span className="block text-[11px] text-ink-500">
                        {player.primaryPosition} · fit {Math.round(player.fitness)}%
                        {player.injured ? ` · ${player.injuryDescription ?? 'injured'}` : ''}
                        {player.suspended ? ' · suspended' : ''}
                      </span>
                    </span>
                    <span className="text-sm font-bold tabular-nums">{player.overall}</span>
                  </button>
                </li>
              );
            })}
        </ul>
      </Card>

      <Card>
        <CardTitle action={
          <button
            type="button"
            disabled={disabled || tactics.substitutionPlan.length >= 5 || lineup.bench.length === 0}
            onClick={() => setTactics({
              ...tactics,
              substitutionPlan: [...tactics.substitutionPlan, {
                outPlayerId: lineup.starters[10]?.playerId ?? lineup.starters[0].playerId,
                inPlayerId: lineup.bench[0].playerId,
                minute: 65 + tactics.substitutionPlan.length * 5,
                condition: 'ALWAYS',
              }],
            })}
            className="text-xs text-brand-400 underline underline-offset-4 disabled:opacity-40"
          >
            Add
          </button>
        }
        >
          Planned substitutions
        </CardTitle>
        {tactics.substitutionPlan.length === 0 ? (
          <Empty>No substitutions planned. Tired players will still be replaced automatically late on.</Empty>
        ) : (
          <ul className="space-y-3">
            {tactics.substitutionPlan.map((sub, index) => (
              <li key={index} className="rounded-xl border border-line-700 bg-pitch-850 p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Field label="Off">
                    <select
                      className={inputClass} value={sub.outPlayerId} disabled={disabled}
                      onChange={(e) => setTactics({
                        ...tactics,
                        substitutionPlan: tactics.substitutionPlan.map((x, i) => (i === index ? { ...x, outPlayerId: e.target.value } : x)),
                      })}
                    >
                      {lineup.starters.map((s) => (
                        <option key={s.playerId} value={s.playerId}>{byId.get(s.playerId)?.name ?? s.playerId}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="On">
                    <select
                      className={inputClass} value={sub.inPlayerId} disabled={disabled}
                      onChange={(e) => setTactics({
                        ...tactics,
                        substitutionPlan: tactics.substitutionPlan.map((x, i) => (i === index ? { ...x, inPlayerId: e.target.value } : x)),
                      })}
                    >
                      {lineup.bench.map((b) => (
                        <option key={b.playerId} value={b.playerId}>{byId.get(b.playerId)?.name ?? b.playerId}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={`On ${sub.minute}′`}>
                    <input
                      type="range" min={20} max={89} step={1} value={sub.minute} disabled={disabled}
                      className="h-11 w-full accent-[var(--color-brand-500)]"
                      onChange={(e) => setTactics({
                        ...tactics,
                        substitutionPlan: tactics.substitutionPlan.map((x, i) => (i === index ? { ...x, minute: Number(e.target.value) } : x)),
                      })}
                    />
                  </Field>
                  <Choice
                    label="Only if" value={sub.condition}
                    options={['ALWAYS', 'IF_LEADING', 'IF_DRAWING', 'IF_TRAILING', 'IF_TIRED', 'IF_BOOKED'] as const}
                    disabled={disabled}
                    onChange={(v) => setTactics({
                      ...tactics,
                      substitutionPlan: tactics.substitutionPlan.map((x, i) => (i === index ? { ...x, condition: v } : x)),
                    })}
                  />
                </div>
                <button
                  type="button" disabled={disabled}
                  onClick={() => setTactics({
                    ...tactics,
                    substitutionPlan: tactics.substitutionPlan.filter((_, i) => i !== index),
                  })}
                  className="mt-2 text-xs text-danger-400 underline underline-offset-4 disabled:opacity-40"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

function IssueList({ issues, tone }: { issues: ValidationIssue[]; tone: 'bad' | 'warn' }) {
  if (issues.length === 0) return null;
  return (
    <Alert tone={tone} title={tone === 'bad' ? 'Must be fixed' : 'Worth knowing'}>
      <ul className="list-disc space-y-1 pl-4">
        {issues.map((issue, i) => <li key={`${issue.code}-${i}`}>{issue.message}</li>)}
      </ul>
    </Alert>
  );
}

function ReviewTab({
  validation, analysis, tactics, familiarity,
}: {
  validation: ReturnType<typeof validateMatchPlan>;
  analysis: ReturnType<typeof analyseTacticalChange>;
  tactics: TacticalPlanInput;
  familiarity: TacticsEditorProps['familiarity'];
}) {
  const magnitudeTone = analysis.magnitude === 'MAJOR' ? 'bad'
    : analysis.magnitude === 'MODERATE' ? 'warn' : 'good';

  return (
    <div className="space-y-4">
      <IssueList issues={validation.errors} tone="bad" />
      <IssueList issues={validation.warnings} tone="warn" />

      <Card>
        <CardTitle>Tactical change</CardTitle>
        <div className="mb-3 flex items-center gap-2">
          <Badge tone={magnitudeTone}>
            {analysis.magnitude === 'NONE' ? 'No real change' : `${humanise(analysis.magnitude)} change`}
          </Badge>
          <span className="text-xs text-ink-500">
            Disruption score {(analysis.score * 100).toFixed(0)} of 100
          </span>
        </div>

        {analysis.warnings.length > 0 && (
          <ul className="mb-3 list-disc space-y-1 pl-4 text-sm text-ink-200">
            {analysis.warnings.map((warning, i) => <li key={i}>{warning}</li>)}
          </ul>
        )}

        {analysis.changes.length > 0 && (
          <div className="scroll-x -mx-4 px-4">
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-500">
                  <th className="py-1 pr-3 font-medium">Area</th>
                  <th className="py-1 pr-3 font-medium">From</th>
                  <th className="py-1 pr-3 font-medium">To</th>
                  <th className="py-1 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {analysis.changes.map((change) => (
                  <tr key={change.area} className="border-t border-line-700/50">
                    <td className="py-1.5 pr-3">{change.label}</td>
                    <td className="py-1.5 pr-3 text-ink-400">{humanise(change.from)}</td>
                    <td className="py-1.5 pr-3">{humanise(change.to)}</td>
                    <td className="py-1.5 tabular-nums">{(change.cost * 100).toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>What this will actually affect</CardTitle>
        <div className="space-y-3">
          <Meter label="Pressing coordination" value={100 - analysis.disruption.pressingCoordination * 100} tone="neutral" />
          <Meter label="Build-up security" value={100 - analysis.disruption.buildUpSecurity * 100} tone="neutral" />
          <Meter label="Defensive compactness" value={100 - analysis.disruption.defensiveCompactness * 100} tone="neutral" />
          <Meter label="Positional quality" value={100 - analysis.disruption.positionalQuality * 100} tone="neutral" />
          <Meter label="Transition reliability" value={100 - analysis.disruption.transitionReliability * 100} tone="neutral" />
          <Meter label="Set-piece execution" value={100 - analysis.disruption.setPieceExecution * 100} tone="neutral" />
        </div>
        <p className="mt-3 text-xs text-ink-500">
          Lower bars mean that part of the side will be less reliable this week. Familiarity buys
          consistency, not dominance: player quality, fitness, form and the match itself still decide the result.
        </p>
      </Card>

      <Card>
        <CardTitle>Familiarity with this system</CardTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Meter label={getFormation(tactics.formation).label} value={familiarity.FORMATION[tactics.formation] ?? 30} />
          <Meter label={humanise(tactics.playingStyle)} value={familiarity.PLAYING_STYLE[tactics.playingStyle] ?? 30} />
          <Meter label={`${humanise(tactics.pressing)} pressing`} value={familiarity.PRESSING[tactics.pressing] ?? 30} />
          <Meter label={humanise(tactics.defensiveApproach)} value={familiarity.DEFENSIVE_ORGANISATION[tactics.defensiveApproach] ?? 30} />
          <Meter label={humanise(tactics.buildUp)} value={familiarity.BUILD_UP[tactics.buildUp] ?? 30} />
          <Meter label="Set-piece routines" value={familiarity.SET_PIECES} />
        </div>
      </Card>
    </div>
  );
}

function toSelectable(player: EditorPlayer): SelectablePlayer {
  return {
    id: player.id, name: player.name, primaryPosition: player.primaryPosition,
    secondaryPositions: player.secondaryPositions, attributes: player.attributes,
    fitness: player.fitness, form: player.form, injured: player.injured, suspended: player.suspended,
  };
}
