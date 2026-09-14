import { describe, expect, it } from 'vitest';
import {
  BuildUp, DefensiveApproach, DefensiveLine, FamiliarityDimension, Foot, Formation,
  InjurySeverity, MatchdayPhase, MatchEventType, Mentality, PlanStatus, PlayerRole,
  PlayingStyle, Position, PressingIntensity, RiskTolerance, SetPieceApproach,
  AttackingFocus, TeamSide, Tempo, TrainingFocus, TrainingIntensity, Width,
} from '@prisma/client';
import * as domain from '@/domain/types';

/**
 * The domain declares its own vocabulary so the pure layers do not depend on the
 * generated database client. That only stays safe if the two never drift, which
 * is what this test guards.
 */
const PAIRS: Array<[string, readonly string[], Record<string, string>]> = [
  ['Position', domain.POSITIONS, Position],
  ['Foot', domain.FEET, Foot],
  ['Formation', domain.FORMATIONS, Formation],
  ['Mentality', domain.MENTALITIES, Mentality],
  ['PlayingStyle', domain.PLAYING_STYLES, PlayingStyle],
  ['PressingIntensity', domain.PRESSING_INTENSITIES, PressingIntensity],
  ['DefensiveLine', domain.DEFENSIVE_LINES, DefensiveLine],
  ['BuildUp', domain.BUILD_UPS, BuildUp],
  ['Width', domain.WIDTHS, Width],
  ['DefensiveApproach', domain.DEFENSIVE_APPROACHES, DefensiveApproach],
  ['Tempo', domain.TEMPOS, Tempo],
  ['RiskTolerance', domain.RISK_TOLERANCES, RiskTolerance],
  ['AttackingFocus', domain.ATTACKING_FOCUSES, AttackingFocus],
  ['SetPieceApproach', domain.SET_PIECE_APPROACHES, SetPieceApproach],
  ['PlayerRole', domain.PLAYER_ROLES, PlayerRole],
  ['TrainingFocus', domain.TRAINING_FOCUSES, TrainingFocus],
  ['TrainingIntensity', domain.TRAINING_INTENSITIES, TrainingIntensity],
  ['MatchdayPhase', domain.MATCHDAY_PHASES, MatchdayPhase],
  ['PlanStatus', domain.PLAN_STATUSES, PlanStatus],
  ['FamiliarityDimension', domain.FAMILIARITY_DIMENSIONS, FamiliarityDimension],
  ['InjurySeverity', domain.INJURY_SEVERITIES, InjurySeverity],
  ['TeamSide', domain.TEAM_SIDES, TeamSide],
  ['MatchEventType', domain.MATCH_EVENT_TYPES, MatchEventType],
];

describe('domain vocabulary matches the database schema', () => {
  for (const [name, domainValues, prismaEnum] of PAIRS) {
    it(`${name} is identical in both layers`, () => {
      expect([...domainValues].sort()).toEqual(Object.values(prismaEnum).sort());
    });
  }
});
