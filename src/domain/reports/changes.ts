/**
 * What a plan change actually did, in words a manager can check at a glance.
 *
 * When the coaching staff act on an instruction rather than waiting for a
 * button, the manager loses the chance to read a proposal before it lands. The
 * replacement for that is showing plainly what moved, so an instruction the
 * staff misread is obvious immediately rather than on matchday.
 *
 * Pure, like the rest of the domain: it takes the two plans and the squad names
 * and returns lines. It decides nothing.
 */
import { FORMATION_DEFINITIONS } from '@/domain/tactics/formations';
import type {
  LineupSelectionInput, TacticalPlanInput, TrainingPlanInput,
} from '@/domain/schemas';

function words(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase();
}

function formationLabel(formation: TacticalPlanInput['formation']): string {
  return FORMATION_DEFINITIONS[formation]?.label ?? words(formation);
}

/** Tactical settings worth reporting, in the order a manager thinks about them. */
const TACTICAL_FIELDS = [
  ['formation', 'Formation'],
  ['mentality', 'Mentality'],
  ['playingStyle', 'Playing style'],
  ['pressing', 'Pressing'],
  ['defensiveLine', 'Defensive line'],
  ['buildUp', 'Build-up'],
  ['width', 'Width'],
  ['defensiveApproach', 'Defensive approach'],
  ['tempo', 'Tempo'],
  ['riskTolerance', 'Risk'],
  ['attackingFocus', 'Attacking focus'],
  ['setPieceApproach', 'Set pieces'],
] as const;

export function describeTacticalChange(
  before: TacticalPlanInput | null,
  after: TacticalPlanInput,
): string[] {
  if (!before) return [`Set up in ${formationLabel(after.formation)}`];

  const lines: string[] = [];
  for (const [key, label] of TACTICAL_FIELDS) {
    const from = before[key];
    const to = after[key];
    if (from === to) continue;

    lines.push(key === 'formation'
      ? `Formation ${formationLabel(from as TacticalPlanInput['formation'])} → ${formationLabel(to as TacticalPlanInput['formation'])}`
      : `${label} ${words(String(from))} → ${words(String(to))}`);
  }

  if (before.counterAttack !== after.counterAttack) {
    lines.push(after.counterAttack ? 'Counter-attacking on' : 'Counter-attacking off');
  }
  if (before.offsideTrap !== after.offsideTrap) {
    lines.push(after.offsideTrap ? 'Offside trap on' : 'Offside trap off');
  }

  const subsBefore = before.substitutionPlan?.length ?? 0;
  const subsAfter = after.substitutionPlan?.length ?? 0;
  if (subsBefore !== subsAfter) {
    lines.push(`Planned substitutions ${subsBefore} → ${subsAfter}`);
  }

  return lines;
}

export function describeLineupChange(
  before: LineupSelectionInput | null,
  after: LineupSelectionInput,
  playerName: (playerId: string) => string,
): string[] {
  if (!before) return ['Named a starting eleven'];

  const wasStarting = new Set(before.starters.map((s) => s.playerId));
  const nowStarting = new Set(after.starters.map((s) => s.playerId));

  const brought = after.starters.filter((s) => !wasStarting.has(s.playerId));
  const dropped = before.starters.filter((s) => !nowStarting.has(s.playerId));

  const lines: string[] = [];
  if (brought.length > 0) lines.push(`In: ${brought.map((s) => playerName(s.playerId)).join(', ')}`);
  if (dropped.length > 0) lines.push(`Out: ${dropped.map((s) => playerName(s.playerId)).join(', ')}`);

  // A player who keeps his place in a different job is a real change and is
  // invisible in the in/out lists, which compare squad numbers rather than jobs.
  for (const slot of after.starters) {
    const previous = before.starters.find((s) => s.playerId === slot.playerId);
    if (previous && previous.role !== slot.role) {
      lines.push(`${playerName(slot.playerId)}: ${words(previous.role)} → ${words(slot.role)}`);
    }
  }

  if (before.captainPlayerId !== after.captainPlayerId && after.captainPlayerId) {
    lines.push(`Captain: ${playerName(after.captainPlayerId)}`);
  }

  return lines;
}

export function describeTrainingChange(
  before: TrainingPlanInput | null,
  after: TrainingPlanInput,
): string[] {
  if (!before) {
    return [`Training ${words(after.primaryFocus)}, then ${words(after.secondaryFocus)}`];
  }

  const lines: string[] = [];
  if (before.primaryFocus !== after.primaryFocus) {
    lines.push(`Main focus ${words(before.primaryFocus)} → ${words(after.primaryFocus)}`);
  }
  if (before.secondaryFocus !== after.secondaryFocus) {
    lines.push(`Second focus ${words(before.secondaryFocus)} → ${words(after.secondaryFocus)}`);
  }
  if (before.intensity !== after.intensity) {
    lines.push(`Intensity ${words(before.intensity)} → ${words(after.intensity)}`);
  }
  if (before.targetFormation !== after.targetFormation) {
    lines.push(after.targetFormation
      ? `Rehearsing ${formationLabel(after.targetFormation)}`
      : 'Stopped rehearsing a new shape');
  }
  return lines;
}
