import type { ExecutionModifiers } from '@/domain/familiarity';
import type { TacticalPlanInput } from '@/domain/schemas';
import type {
  MatchEventType, PlayerAttributes, PlayerRole, Position, TeamSide,
} from '@/domain/types';

export interface EnginePlayer {
  id: string;
  name: string;
  shirtNumber: number;
  /** Position of the slot the player occupies, not necessarily their own. */
  position: Position;
  slot: string;
  role: PlayerRole;
  attributes: PlayerAttributes;
  /** 0-1 positional suitability, precomputed by the domain layer. */
  suitability: number;
  fitness: number;
  form: number;
  morale: number;
  confidence: number;
  matchSharpness: number;
  /** Per-player familiarity with the role and position they have been given. */
  roleFamiliarity: number;
  positionFamiliarity: number;
}

export interface EngineTeam {
  clubId: string;
  name: string;
  shortName: string;
  side: TeamSide;
  reputation: number;
  morale: number;
  tactics: TacticalPlanInput;
  starters: EnginePlayer[];
  bench: EnginePlayer[];
  execution: ExecutionModifiers;
}

export interface MatchInput {
  fixtureId: string;
  seed: string;
  home: EngineTeam;
  away: EngineTeam;
  neutralVenue?: boolean;
}

export interface EngineEvent {
  sequence: number;
  minute: number;
  type: MatchEventType;
  side?: TeamSide;
  playerId?: string;
  secondaryPlayerId?: string;
  description: string;
  detail: Record<string, unknown>;
}

export interface TeamStats {
  possession: number;
  shots: number;
  shotsOnTarget: number;
  expectedGoals: number;
  passes: number;
  passesCompleted: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  corners: number;
  offsides: number;
  tackles: number;
  interceptions: number;
  pressingActions: number;
  saves: number;
  bigChances: number;
  goals: number;
  /** How the side actually played, derived from what happened. */
  tacticalSummary: TacticalSummary;
}

export interface TacticalSummary {
  formation: string;
  mentality: string;
  playingStyle: string;
  pressing: string;
  defensiveLine: string;
  /** Share of sequences that ended in the final third. */
  territory: number;
  /** Defensive actions per opposition sequence: a pressing fingerprint. */
  pressingRate: number;
  /** Share of goals that came from transitions. */
  counterAttackGoals: number;
  setPieceGoals: number;
  directness: number;
  formationChanges: number;
}

export interface PlayerPerformance {
  playerId: string;
  clubId: string;
  side: TeamSide;
  minutesPlayed: number;
  position: Position;
  role: PlayerRole;
  rating: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  expectedGoals: number;
  passes: number;
  passesCompleted: number;
  keyPasses: number;
  tackles: number;
  interceptions: number;
  saves: number;
  fouls: number;
  yellowCard: boolean;
  redCard: boolean;
  injured: boolean;
  /** How tired the player finished, fed back into the weekly cycle. */
  endFitness: number;
}

export interface MatchResult {
  engineVersion: string;
  seed: string;
  fixtureId: string;
  homeGoals: number;
  awayGoals: number;
  events: EngineEvent[];
  stats: Record<TeamSide, TeamStats>;
  performances: PlayerPerformance[];
}
