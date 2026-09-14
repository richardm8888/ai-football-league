import { z } from 'zod';
import {
  ATTACKING_FOCUSES, BUILD_UPS, DEFENSIVE_APPROACHES, DEFENSIVE_LINES, FORMATIONS,
  MENTALITIES, PLAYER_ROLES, PLAYING_STYLES, POSITIONS, PRESSING_INTENSITIES,
  RISK_TOLERANCES, SET_PIECE_APPROACHES, TEMPOS, TRAINING_FOCUSES,
  TRAINING_INTENSITIES, WIDTHS,
} from './types';

/**
 * The domain command surface.
 *
 * Everything that can change a club's competitive state — whether typed by a
 * human into a form or proposed by the AI coaching staff — must parse cleanly
 * against one of these schemas first. The AI layer has no other way in.
 */

export const formationSchema = z.enum(FORMATIONS);
export const positionSchema = z.enum(POSITIONS);
export const playerRoleSchema = z.enum(PLAYER_ROLES);

// --- Match-state instructions ----------------------------------------------

export const MATCH_STATE_TRIGGERS = [
  'LEADING', 'LEADING_BY_TWO', 'DRAWING', 'TRAILING', 'TRAILING_BY_TWO',
  'AFTER_60', 'AFTER_75', 'RED_CARD_FOR', 'RED_CARD_AGAINST',
] as const;
export type MatchStateTrigger = (typeof MATCH_STATE_TRIGGERS)[number];

export const MATCH_STATE_ADJUSTMENTS = [
  'MORE_ATTACKING', 'MORE_DEFENSIVE', 'PRESS_HIGHER', 'DROP_DEEPER',
  'SLOW_TEMPO', 'RAISE_TEMPO', 'GO_DIRECT', 'KEEP_THE_BALL', 'WASTE_TIME',
] as const;
export type MatchStateAdjustment = (typeof MATCH_STATE_ADJUSTMENTS)[number];

export const matchStateInstructionSchema = z.object({
  trigger: z.enum(MATCH_STATE_TRIGGERS),
  adjustment: z.enum(MATCH_STATE_ADJUSTMENTS),
  /** Earliest minute at which the instruction may fire. */
  fromMinute: z.number().int().min(0).max(90).default(0),
  note: z.string().max(200).default(''),
});
export type MatchStateInstruction = z.infer<typeof matchStateInstructionSchema>;

// --- Substitutions ----------------------------------------------------------

export const SUBSTITUTION_CONDITIONS = [
  'ALWAYS', 'IF_LEADING', 'IF_DRAWING', 'IF_TRAILING', 'IF_TIRED', 'IF_BOOKED',
] as const;

export const substitutionSchema = z.object({
  outPlayerId: z.string().min(1),
  inPlayerId: z.string().min(1),
  minute: z.number().int().min(20).max(89),
  condition: z.enum(SUBSTITUTION_CONDITIONS).default('ALWAYS'),
  /** Role the incoming player takes; defaults to the slot's role. */
  role: playerRoleSchema.optional(),
});
export type Substitution = z.infer<typeof substitutionSchema>;

export const substitutionPlanSchema = z.array(substitutionSchema).max(5);
export type SubstitutionPlan = z.infer<typeof substitutionPlanSchema>;

// --- Tactical plan ----------------------------------------------------------

export const tacticalPlanSchema = z.object({
  formation: formationSchema,
  mentality: z.enum(MENTALITIES),
  playingStyle: z.enum(PLAYING_STYLES),
  pressing: z.enum(PRESSING_INTENSITIES),
  defensiveLine: z.enum(DEFENSIVE_LINES),
  buildUp: z.enum(BUILD_UPS),
  width: z.enum(WIDTHS),
  defensiveApproach: z.enum(DEFENSIVE_APPROACHES),
  tempo: z.enum(TEMPOS),
  riskTolerance: z.enum(RISK_TOLERANCES),
  attackingFocus: z.enum(ATTACKING_FOCUSES),
  setPieceApproach: z.enum(SET_PIECE_APPROACHES),
  counterPress: z.boolean().default(false),
  counterAttack: z.boolean().default(false),
  offsideTrap: z.boolean().default(false),
  /** 0 = full-backs stay home, 100 = full-backs join the attack freely. */
  fullBackFreedom: z.number().int().min(0).max(100).default(50),
  matchStateInstructions: z.array(matchStateInstructionSchema).max(6).default([]),
  substitutionPlan: substitutionPlanSchema.default([]),
});
export type TacticalPlanInput = z.infer<typeof tacticalPlanSchema>;

// --- Line-up ----------------------------------------------------------------

export const lineupSlotSchema = z.object({
  slot: z.string().min(1).max(8),
  playerId: z.string().min(1),
  role: playerRoleSchema,
});

export const benchSlotSchema = z.object({
  playerId: z.string().min(1),
  order: z.number().int().min(0).max(8),
});

export const lineupSelectionSchema = z.object({
  starters: z.array(lineupSlotSchema).length(11),
  bench: z.array(benchSlotSchema).min(0).max(7),
  captainPlayerId: z.string().min(1).optional(),
});
export type LineupSelectionInput = z.infer<typeof lineupSelectionSchema>;

/** A tactical plan and the line-up that plays it: what a manager actually locks. */
export const matchPlanSchema = z.object({
  tactics: tacticalPlanSchema,
  lineup: lineupSelectionSchema,
  notes: z.string().max(2000).default(''),
});
export type MatchPlanInput = z.infer<typeof matchPlanSchema>;

// --- Training ---------------------------------------------------------------

export const individualFocusSchema = z.object({
  playerId: z.string().min(1),
  role: playerRoleSchema,
});

export const trainingPlanSchema = z
  .object({
    primaryFocus: z.enum(TRAINING_FOCUSES),
    secondaryFocus: z.enum(TRAINING_FOCUSES),
    intensity: z.enum(TRAINING_INTENSITIES),
    /**
     * Formation to rehearse when a focus is FORMATION_FAMILIARITY. Naming a shape
     * the side is not yet playing is how a manager phases a change in gradually.
     */
    targetFormation: formationSchema.nullable().default(null),
    individualFocus: z.array(individualFocusSchema).max(4).default([]),
    notes: z.string().max(2000).default(''),
  })
  .refine((v) => v.primaryFocus !== v.secondaryFocus, {
    message: 'Primary and secondary training focus must differ.',
    path: ['secondaryFocus'],
  });
export type TrainingPlanInput = z.infer<typeof trainingPlanSchema>;

// --- Scouting ---------------------------------------------------------------

export const scoutingSummarySchema = z.object({
  opponentClubId: z.string().min(1),
  headline: z.string().max(200),
  observedStrengths: z.array(z.string().max(200)).max(6),
  observedWeaknesses: z.array(z.string().max(200)).max(6),
  /** Every claim must cite the public statistic it came from. */
  evidence: z.array(z.object({
    claim: z.string().max(200),
    statistic: z.string().max(120),
    value: z.string().max(60),
  })).max(10),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
});
export type ScoutingSummaryInput = z.infer<typeof scoutingSummarySchema>;

// --- AI proposal envelope ---------------------------------------------------

/**
 * What the coaching staff is allowed to hand back. Note that it contains no
 * results, no attribute edits and no free-form state: a proposal can only ever
 * ask the human to approve a tactical plan, a line-up or a training plan.
 */
export const coachProposalSchema = z.object({
  message: z.string().max(4000),
  rationale: z.string().max(4000).default(''),
  risks: z.array(z.string().max(300)).max(8).default([]),
  clarifyingQuestions: z.array(z.string().max(300)).max(4).default([]),
  tactics: tacticalPlanSchema.partial().optional(),
  lineup: lineupSelectionSchema.optional(),
  training: trainingPlanSchema.optional(),
  scouting: scoutingSummarySchema.optional(),
});
export type CoachProposal = z.infer<typeof coachProposalSchema>;
