import { emptyClubFamiliarity, type ClubFamiliarity, type PlayerFamiliarityMap } from '@/domain/familiarity';
import type { LineupSelectionInput, TacticalPlanInput } from '@/domain/schemas';
import { generateSquad, type GeneratedPlayer } from '@/domain/generation/squad';
import { autoSelectLineup, defaultTacticalPlan, type SelectablePlayer } from '@/domain/tactics/selection';
import type { Formation, TeamSide } from '@/domain/types';
import { buildEngineTeam, type BuildablePlayer, type TeamBuildInput } from '@/engine/build';
import type { EngineTeam } from '@/engine/types';

/** Shared test fixtures: a squad, a plan and an engine-ready team. */

export interface TestClub {
  clubId: string;
  name: string;
  shortName: string;
  reputation: number;
  players: BuildablePlayer[];
  selectable: SelectablePlayer[];
  generated: GeneratedPlayer[];
}

export function makeClub(id: string, reputation = 65, seed = id): TestClub {
  const generated = generateSquad({ seed, clubReputation: reputation });
  const players: BuildablePlayer[] = generated.map((p, i) => ({
    id: `${id}-p${i}`,
    name: `${p.firstName} ${p.lastName}`,
    shirtNumber: p.shirtNumber,
    primaryPosition: p.primaryPosition,
    secondaryPositions: p.secondaryPositions,
    attributes: p.attributes,
    fitness: p.fitness,
    form: p.form,
    morale: p.morale,
    confidence: 55,
    matchSharpness: p.matchSharpness,
  }));
  const selectable: SelectablePlayer[] = players.map((p) => ({
    id: p.id,
    name: p.name,
    primaryPosition: p.primaryPosition,
    secondaryPositions: p.secondaryPositions,
    attributes: p.attributes,
    fitness: p.fitness,
    form: p.form,
    injured: false,
    suspended: false,
  }));
  return { clubId: id, name: `${id} FC`, shortName: id.slice(0, 3).toUpperCase(), reputation, players, selectable, generated };
}

export function makeLineup(club: TestClub, formation: Formation = 'F_4_3_3'): LineupSelectionInput {
  return autoSelectLineup(club.selectable, formation);
}

export interface BuildTeamOptions {
  tactics?: Partial<TacticalPlanInput>;
  familiarity?: ClubFamiliarity;
  playerFamiliarity?: PlayerFamiliarityMap;
  previousPlan?: TacticalPlanInput | null;
  morale?: number;
}

export function buildTeam(
  club: TestClub, side: TeamSide, options: BuildTeamOptions = {},
): { team: EngineTeam; tactics: TacticalPlanInput; lineup: LineupSelectionInput } {
  const tactics: TacticalPlanInput = { ...defaultTacticalPlan(), ...options.tactics };
  const lineup = makeLineup(club, tactics.formation);
  const input: TeamBuildInput = {
    clubId: club.clubId,
    name: club.name,
    shortName: club.shortName,
    side,
    reputation: club.reputation,
    morale: options.morale ?? 60,
    tactics,
    lineup,
    players: club.players,
    familiarity: options.familiarity ?? wellDrilled(tactics),
    playerFamiliarity: options.playerFamiliarity ?? {},
    previousPlan: options.previousPlan ?? null,
  };
  return { team: buildEngineTeam(input).team, tactics, lineup };
}

/** A club that has been playing this system all season. */
export function wellDrilled(plan: TacticalPlanInput, value = 70): ClubFamiliarity {
  const f = emptyClubFamiliarity();
  f.FORMATION[plan.formation] = value;
  f.PLAYING_STYLE[plan.playingStyle] = value;
  f.PRESSING[plan.pressing] = value;
  f.DEFENSIVE_ORGANISATION[plan.defensiveApproach] = value;
  f.BUILD_UP[plan.buildUp] = value;
  f.TRANSITION = value;
  f.SET_PIECES = value;
  f.OVERALL_STABILITY = value;
  return f;
}
