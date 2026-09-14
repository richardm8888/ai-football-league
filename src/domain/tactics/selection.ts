import type { LineupSelectionInput, TacticalPlanInput } from '../schemas';
import type { Formation, PlayerAttributes, PlayerRole, Position } from '../types';
import { getFormation } from './formations';
import { rolesForPosition } from './roles';
import { clamp, positionSuitability, roleAptitude } from './suitability';

/**
 * Sensible defaults and automatic selection.
 *
 * These exist so a manager is never stuck: a club always has a workable plan,
 * and every screen has a "pick a sensible side for me" button that owes nothing
 * to the AI provider being available.
 */

export interface SelectablePlayer {
  id: string;
  name: string;
  primaryPosition: Position;
  secondaryPositions: Position[];
  attributes: PlayerAttributes;
  fitness: number;
  form: number;
  injured: boolean;
  suspended: boolean;
}

export function defaultTacticalPlan(formation: Formation = 'F_4_3_3'): TacticalPlanInput {
  return {
    formation,
    mentality: 'BALANCED',
    playingStyle: 'BALANCED',
    pressing: 'MEDIUM',
    defensiveLine: 'STANDARD',
    buildUp: 'MIXED',
    width: 'BALANCED',
    defensiveApproach: 'MID_BLOCK',
    tempo: 'NORMAL',
    riskTolerance: 'BALANCED',
    attackingFocus: 'MIXED',
    setPieceApproach: 'MIXED',
    counterPress: false,
    counterAttack: false,
    offsideTrap: false,
    fullBackFreedom: 50,
    matchStateInstructions: [],
    substitutionPlan: [],
  };
}

/** Best role for a player in a given slot, by attribute fit. */
export function bestRoleForSlot(
  player: SelectablePlayer, formation: Formation, slotKey: string,
): PlayerRole {
  const slot = getFormation(formation).slots.find((s) => s.key === slotKey);
  if (!slot) return 'CENTRAL_MIDFIELDER';
  const candidates = rolesForPosition(slot.position);
  if (candidates.length === 0) return slot.defaultRole;
  let best = slot.defaultRole;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    // Prefer simpler roles slightly: they are quicker to learn.
    const score = roleAptitude(player.attributes, candidate.role) - (candidate.complexity - 1) * 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = candidate.role;
    }
  }
  return best;
}

function availability(player: SelectablePlayer): boolean {
  return !player.injured && !player.suspended && player.fitness >= 40;
}

/** How good this player would be in this slot right now. */
export function slotScore(player: SelectablePlayer, formation: Formation, slotKey: string): number {
  const slot = getFormation(formation).slots.find((s) => s.key === slotKey);
  if (!slot) return 0;
  const role = bestRoleForSlot(player, formation, slotKey);
  const aptitude = roleAptitude(player.attributes, role);
  const suitability = positionSuitability(player, slot.position);
  const condition = (0.6 + 0.4 * clamp(player.fitness, 0, 100) / 100)
    * (0.9 + 0.2 * clamp(player.form, 0, 100) / 100);
  return aptitude * (0.4 + 0.6 * suitability) * condition;
}

/**
 * Greedy best-eleven selection: fill the hardest slots first (goalkeeper, then
 * the slots with the fewest credible candidates), which avoids the classic
 * failure of spending your only left-back at left midfield.
 */
export function autoSelectLineup(
  squad: SelectablePlayer[], formation: Formation,
): LineupSelectionInput {
  const available = squad.filter(availability);
  const slots = getFormation(formation).slots;
  const taken = new Set<string>();
  const starters: LineupSelectionInput['starters'] = [];

  const scarcity = slots
    .map((slot) => {
      const candidates = available.filter(
        (p) => positionSuitability(p, slot.position) >= 0.85).length;
      return { slot, candidates };
    })
    .sort((a, b) =>
      (a.slot.position === 'GK' ? -1 : 0) - (b.slot.position === 'GK' ? -1 : 0)
      || a.candidates - b.candidates);

  for (const { slot } of scarcity) {
    const pool = available.filter((p) => !taken.has(p.id));
    if (pool.length === 0) break;
    const best = pool.reduce((a, b) =>
      slotScore(b, formation, slot.key) > slotScore(a, formation, slot.key) ? b : a);
    taken.add(best.id);
    starters.push({
      slot: slot.key,
      playerId: best.id,
      role: bestRoleForSlot(best, formation, slot.key),
    });
  }

  // Bench: a spare keeper first, then the best remaining outfielders.
  const remaining = available.filter((p) => !taken.has(p.id));
  const spareKeeper = remaining.find((p) => p.primaryPosition === 'GK');
  const outfield = remaining
    .filter((p) => p.id !== spareKeeper?.id)
    .sort((a, b) =>
      roleAptitude(b.attributes, bestRoleForSlot(b, formation, slotForPosition(formation, b.primaryPosition)))
      - roleAptitude(a.attributes, bestRoleForSlot(a, formation, slotForPosition(formation, a.primaryPosition))));

  const benchPlayers = [...(spareKeeper ? [spareKeeper] : []), ...outfield].slice(0, 7);
  const bench = benchPlayers.map((p, i) => ({ playerId: p.id, order: i }));

  const captain = starters
    .map((s) => available.find((p) => p.id === s.playerId)!)
    .filter(Boolean)
    .sort((a, b) =>
      (b.attributes.determination + b.attributes.teamwork + b.attributes.decisions)
      - (a.attributes.determination + a.attributes.teamwork + a.attributes.decisions))[0];

  return {
    starters: starters.sort((a, b) =>
      slots.findIndex((s) => s.key === a.slot) - slots.findIndex((s) => s.key === b.slot)),
    bench,
    captainPlayerId: captain?.id,
  };
}

function slotForPosition(formation: Formation, position: Position): string {
  const slots = getFormation(formation).slots;
  return (slots.find((s) => s.position === position) ?? slots[5]).key;
}

/** A default set of substitutions: freshen the attack and midfield late on. */
export function defaultSubstitutionPlan(
  lineup: LineupSelectionInput, squad: SelectablePlayer[], formation: Formation,
): TacticalPlanInput['substitutionPlan'] {
  const byId = new Map(squad.map((p) => [p.id, p]));
  const slots = getFormation(formation).slots;
  const attackingSlots = new Set(slots.filter((s) => s.band === 'ATTACK').map((s) => s.key));
  const midfieldSlots = new Set(slots.filter((s) => s.band === 'MIDFIELD').map((s) => s.key));

  const candidatesOff = lineup.starters
    .filter((s) => attackingSlots.has(s.slot) || midfieldSlots.has(s.slot))
    .map((s) => ({ slot: s.slot, player: byId.get(s.playerId) }))
    .filter((x): x is { slot: string; player: SelectablePlayer } => Boolean(x.player))
    .sort((a, b) => a.player.fitness - b.player.fitness);

  const benchOutfield = lineup.bench
    .map((b) => byId.get(b.playerId))
    .filter((p): p is SelectablePlayer => p !== undefined && p.primaryPosition !== 'GK');

  const plan: TacticalPlanInput['substitutionPlan'] = [];
  const minutes = [64, 72, 80];
  for (let i = 0; i < Math.min(3, candidatesOff.length, benchOutfield.length); i += 1) {
    plan.push({
      outPlayerId: candidatesOff[i].player.id,
      inPlayerId: benchOutfield[i].id,
      minute: minutes[i],
      condition: 'ALWAYS',
    });
  }
  return plan;
}
