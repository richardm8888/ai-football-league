import {
  analyseTacticalChange, executionModifiers, positionalFamiliarity,
  UNTRAINED_FAMILIARITY, type ClubFamiliarity, type PlayerFamiliarityMap,
  type TacticalChangeAnalysis,
} from '@/domain/familiarity';
import type { LineupSelectionInput, TacticalPlanInput } from '@/domain/schemas';
import { getFormation } from '@/domain/tactics/formations';
import { positionSuitability } from '@/domain/tactics/suitability';
import type { PlayerAttributes, Position, TeamSide } from '@/domain/types';
import type { EnginePlayer, EngineTeam } from './types';

/**
 * Assembling the engine's input.
 *
 * This is the seam between the stored game state and the simulation. It is pure
 * so that tests can build a match without a database, and so the exact input can
 * be snapshotted alongside the result for auditing.
 */

export interface BuildablePlayer {
  id: string;
  name: string;
  shirtNumber: number;
  primaryPosition: Position;
  secondaryPositions: Position[];
  attributes: PlayerAttributes;
  fitness: number;
  form: number;
  morale: number;
  confidence: number;
  matchSharpness: number;
}

export interface TeamBuildInput {
  clubId: string;
  name: string;
  shortName: string;
  side: TeamSide;
  reputation: number;
  morale: number;
  tactics: TacticalPlanInput;
  lineup: LineupSelectionInput;
  players: BuildablePlayer[];
  familiarity: ClubFamiliarity;
  playerFamiliarity: PlayerFamiliarityMap;
  /** The plan the club played last time out, used to price this week's changes. */
  previousPlan: TacticalPlanInput | null;
}

export interface BuiltTeam {
  team: EngineTeam;
  analysis: TacticalChangeAnalysis;
}

export function buildEngineTeam(input: TeamBuildInput): BuiltTeam {
  const byId = new Map(input.players.map((p) => [p.id, p]));
  const slots = getFormation(input.tactics.formation).slots;

  const starters: EnginePlayer[] = [];
  for (const entry of input.lineup.starters) {
    const player = byId.get(entry.playerId);
    const slot = slots.find((s) => s.key === entry.slot);
    if (!player || !slot) continue;
    starters.push(toEnginePlayer(player, slot.key, slot.position, entry.role, input.playerFamiliarity));
  }

  const bench: EnginePlayer[] = [];
  for (const entry of [...input.lineup.bench].sort((a, b) => a.order - b.order)) {
    const player = byId.get(entry.playerId);
    if (!player) continue;
    // A substitute comes on in a slot that suits them.
    const slot = slots.find((s) => s.position === player.primaryPosition)
      ?? slots.find((s) => player.secondaryPositions.includes(s.position))
      ?? slots[5];
    bench.push(toEnginePlayer(player, slot.key, player.primaryPosition, slot.defaultRole, input.playerFamiliarity));
  }

  const analysis = analyseTacticalChange(input.tactics, input.familiarity, input.previousPlan);
  const positional = positionalFamiliarity(
    input.playerFamiliarity,
    starters.map((s) => ({ playerId: s.id, role: s.role, position: s.position })));
  const execution = executionModifiers(input.familiarity, input.tactics, analysis, positional);

  return {
    team: {
      clubId: input.clubId,
      name: input.name,
      shortName: input.shortName,
      side: input.side,
      reputation: input.reputation,
      morale: input.morale,
      tactics: input.tactics,
      starters,
      bench,
      execution,
    },
    analysis,
  };
}

function toEnginePlayer(
  player: BuildablePlayer, slot: string, position: Position,
  role: EnginePlayer['role'], familiarity: PlayerFamiliarityMap,
): EnginePlayer {
  const entry = familiarity[player.id];
  return {
    id: player.id,
    name: player.name,
    shirtNumber: player.shirtNumber,
    position,
    slot,
    role,
    attributes: player.attributes,
    suitability: positionSuitability(player, position),
    fitness: player.fitness,
    form: player.form,
    morale: player.morale,
    confidence: player.confidence,
    matchSharpness: player.matchSharpness,
    roleFamiliarity: entry?.roles[role] ?? UNTRAINED_FAMILIARITY,
    positionFamiliarity: entry?.positions[position] ?? UNTRAINED_FAMILIARITY,
  };
}
