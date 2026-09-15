/**
 * The domain's own vocabulary.
 *
 * These unions are declared independently of the generated Prisma client so the
 * domain and the match engine stay pure and testable without a database. A
 * compile-time test (tests/domain/enum-parity.test.ts) asserts that they remain
 * exactly in step with the schema enums.
 */

export const POSITIONS = [
  'GK', 'DC', 'DL', 'DR', 'DM', 'MC', 'ML', 'MR', 'AM', 'AML', 'AMR', 'ST',
] as const;
export type Position = (typeof POSITIONS)[number];

export const FEET = ['LEFT', 'RIGHT', 'BOTH'] as const;
export type Foot = (typeof FEET)[number];

export const FORMATIONS = ['F_4_3_3', 'F_4_2_3_1', 'F_4_4_2', 'F_3_5_2', 'F_5_3_2'] as const;
export type Formation = (typeof FORMATIONS)[number];

export const MENTALITIES = [
  'VERY_DEFENSIVE', 'DEFENSIVE', 'BALANCED', 'POSITIVE', 'ATTACKING',
] as const;
export type Mentality = (typeof MENTALITIES)[number];

export const PLAYING_STYLES = [
  'POSSESSION', 'BALANCED', 'DIRECT', 'COUNTER_ATTACKING', 'HIGH_TEMPO', 'PATIENT_BUILD_UP',
] as const;
export type PlayingStyle = (typeof PLAYING_STYLES)[number];

export const PRESSING_INTENSITIES = ['LOW', 'MEDIUM', 'HIGH', 'INTENSE'] as const;
export type PressingIntensity = (typeof PRESSING_INTENSITIES)[number];

export const DEFENSIVE_LINES = ['DEEP', 'STANDARD', 'HIGH', 'VERY_HIGH'] as const;
export type DefensiveLine = (typeof DEFENSIVE_LINES)[number];

export const BUILD_UPS = ['SHORT_PASSING', 'MIXED', 'DIRECT', 'LONG_DISTRIBUTION'] as const;
export type BuildUp = (typeof BUILD_UPS)[number];

export const WIDTHS = ['NARROW', 'BALANCED', 'WIDE'] as const;
export type Width = (typeof WIDTHS)[number];

export const DEFENSIVE_APPROACHES = [
  'ZONAL', 'MAN_ORIENTED', 'AGGRESSIVE_PRESSING', 'COMPACT_BLOCK', 'MID_BLOCK', 'LOW_BLOCK',
] as const;
export type DefensiveApproach = (typeof DEFENSIVE_APPROACHES)[number];

export const TEMPOS = ['VERY_SLOW', 'SLOW', 'NORMAL', 'FAST', 'VERY_FAST'] as const;
export type Tempo = (typeof TEMPOS)[number];

export const RISK_TOLERANCES = ['CAUTIOUS', 'MEASURED', 'BALANCED', 'BOLD', 'RECKLESS'] as const;
export type RiskTolerance = (typeof RISK_TOLERANCES)[number];

export const ATTACKING_FOCUSES = [
  'LEFT_FLANK', 'RIGHT_FLANK', 'BOTH_FLANKS', 'CENTRAL', 'MIXED',
] as const;
export type AttackingFocus = (typeof ATTACKING_FOCUSES)[number];

export const SET_PIECE_APPROACHES = [
  'SHORT', 'MIXED', 'DIRECT_DELIVERY', 'NEAR_POST', 'FAR_POST',
] as const;
export type SetPieceApproach = (typeof SET_PIECE_APPROACHES)[number];

export const PLAYER_ROLES = [
  'GOALKEEPER', 'SWEEPER_KEEPER',
  'FULL_BACK', 'WING_BACK', 'INVERTED_FULL_BACK', 'ATTACKING_FULL_BACK',
  'CENTRAL_DEFENDER', 'BALL_PLAYING_DEFENDER', 'STOPPER', 'COVER_DEFENDER', 'WIDE_CENTRE_BACK',
  'ANCHOR', 'DEEP_LYING_PLAYMAKER', 'BALL_WINNING_MIDFIELDER', 'HALF_BACK',
  'CENTRAL_MIDFIELDER', 'BOX_TO_BOX', 'MEZZALA', 'ROAMING_PLAYMAKER', 'CARRILERO',
  'ATTACKING_MIDFIELDER', 'ADVANCED_PLAYMAKER', 'SHADOW_STRIKER',
  'WINGER', 'INVERTED_WINGER', 'WIDE_PLAYMAKER', 'WIDE_TARGET_MAN',
  'ADVANCED_FORWARD', 'TARGET_MAN', 'POACHER', 'COMPLETE_FORWARD', 'FALSE_NINE', 'PRESSING_FORWARD',
] as const;
export type PlayerRole = (typeof PLAYER_ROLES)[number];

export const TRAINING_FOCUSES = [
  'RECOVERY', 'FITNESS', 'POSSESSION', 'PRESSING', 'DEFENSIVE_ORGANISATION',
  'ATTACKING_PATTERNS', 'TRANSITION_PLAY', 'SET_PIECES', 'FORMATION_FAMILIARITY',
  'INDIVIDUAL_ROLES', 'MATCH_PREPARATION',
] as const;
export type TrainingFocus = (typeof TRAINING_FOCUSES)[number];

export const TRAINING_INTENSITIES = ['LIGHT', 'NORMAL', 'HIGH', 'VERY_HIGH'] as const;
export type TrainingIntensity = (typeof TRAINING_INTENSITIES)[number];

export const MATCHDAY_PHASES = [
  'OPEN', 'LOCKED', 'SIMULATION', 'POST_MATCH', 'COMPLETE',
] as const;
export type MatchdayPhase = (typeof MATCHDAY_PHASES)[number];

export const PLAN_STATUSES = ['DRAFT', 'PROPOSED', 'APPROVED', 'LOCKED'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const FAMILIARITY_DIMENSIONS = [
  'FORMATION', 'PLAYING_STYLE', 'PRESSING', 'DEFENSIVE_ORGANISATION',
  'BUILD_UP', 'TRANSITION', 'SET_PIECES', 'OVERALL_STABILITY',
] as const;
export type FamiliarityDimension = (typeof FAMILIARITY_DIMENSIONS)[number];

export const INJURY_SEVERITIES = ['NONE', 'KNOCK', 'MINOR', 'MODERATE', 'SERIOUS'] as const;
export type InjurySeverity = (typeof INJURY_SEVERITIES)[number];

export const TEAM_SIDES = ['HOME', 'AWAY'] as const;
export type TeamSide = (typeof TEAM_SIDES)[number];

export const MATCH_EVENT_TYPES = [
  'KICK_OFF', 'POSSESSION_SEQUENCE', 'BUILD_UP', 'PRESSING_ACTION', 'TACKLE',
  'INTERCEPTION', 'FOUL', 'YELLOW_CARD', 'RED_CARD', 'SHOT', 'SHOT_ON_TARGET',
  'SAVE', 'GOAL', 'OWN_GOAL', 'PENALTY_AWARDED', 'PENALTY_MISSED', 'CORNER',
  'OFFSIDE', 'INJURY', 'SUBSTITUTION', 'TACTICAL_CHANGE', 'HALF_TIME', 'FULL_TIME',
] as const;
export type MatchEventType = (typeof MATCH_EVENT_TYPES)[number];

// --- Player attributes ------------------------------------------------------

export const TECHNICAL_ATTRIBUTES = [
  'passing', 'firstTouch', 'dribbling', 'finishing', 'crossing',
  'tackling', 'marking', 'heading', 'longShots', 'setPieces',
] as const;

export const MENTAL_ATTRIBUTES = [
  'decisions', 'positioning', 'composure', 'concentration', 'anticipation',
  'workRate', 'teamwork', 'vision', 'determination',
] as const;

export const PHYSICAL_ATTRIBUTES = [
  'pace', 'acceleration', 'stamina', 'strength', 'agility', 'balance',
] as const;

export const GOALKEEPING_ATTRIBUTES = [
  'handling', 'reflexes', 'oneOnOnes', 'distribution',
] as const;

export const ATTRIBUTE_KEYS = [
  ...TECHNICAL_ATTRIBUTES,
  ...MENTAL_ATTRIBUTES,
  ...PHYSICAL_ATTRIBUTES,
  ...GOALKEEPING_ATTRIBUTES,
] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

export type PlayerAttributes = Record<AttributeKey, number>;

export interface PlayerCondition {
  fitness: number;
  fatigue: number;
  morale: number;
  form: number;
  confidence: number;
  matchSharpness: number;
  injury: InjurySeverity;
  injuryWeeksLeft: number;
  suspensionMatches: number;
}
