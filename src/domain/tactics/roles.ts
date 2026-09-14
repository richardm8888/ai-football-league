import type { AttributeKey, PlayerRole, Position } from '../types';

/**
 * What a role actually asks a player to do.
 *
 * `emphasis` is the bridge into the match engine: a role does not simply make a
 * player "better", it shifts where their ability is applied. A ball-winning
 * midfielder pushes weight into pressing and defending; a deep-lying playmaker
 * pushes it into build-up and creation.
 */
export interface RoleDefinition {
  role: PlayerRole;
  label: string;
  positions: Position[];
  duty: 'DEFEND' | 'SUPPORT' | 'ATTACK';
  description: string;
  /** Attributes that decide how well a player performs this role. */
  keyAttributes: AttributeKey[];
  emphasis: RoleEmphasis;
  /** Roles asking a lot of unfamiliar movement are harder to learn. */
  complexity: 1 | 2 | 3;
}

export interface RoleEmphasis {
  defending: number;
  pressing: number;
  buildUp: number;
  creation: number;
  finishing: number;
  width: number;
  transition: number;
  aerial: number;
}

const e = (p: Partial<RoleEmphasis>): RoleEmphasis => ({
  defending: 0, pressing: 0, buildUp: 0, creation: 0,
  finishing: 0, width: 0, transition: 0, aerial: 0, ...p,
});

export const ROLE_DEFINITIONS: Record<PlayerRole, RoleDefinition> = {
  GOALKEEPER: {
    role: 'GOALKEEPER', label: 'Goalkeeper', positions: ['GK'], duty: 'DEFEND', complexity: 1,
    description: 'Holds the line, stays in the box and prioritises safe handling.',
    keyAttributes: ['reflexes', 'handling', 'oneOnOnes', 'positioning', 'concentration'],
    emphasis: e({ defending: 1.0 }),
  },
  SWEEPER_KEEPER: {
    role: 'SWEEPER_KEEPER', label: 'Sweeper keeper', positions: ['GK'], duty: 'SUPPORT', complexity: 3,
    description: 'Defends the space behind a high line and starts build-up with his feet.',
    keyAttributes: ['reflexes', 'oneOnOnes', 'distribution', 'anticipation', 'composure', 'pace'],
    emphasis: e({ defending: 0.85, buildUp: 0.5, transition: 0.2 }),
  },

  FULL_BACK: {
    role: 'FULL_BACK', label: 'Full-back', positions: ['DL', 'DR'], duty: 'DEFEND', complexity: 1,
    description: 'Defends the flank first and supports attacks conservatively.',
    keyAttributes: ['marking', 'tackling', 'positioning', 'stamina', 'concentration'],
    emphasis: e({ defending: 0.8, width: 0.3, pressing: 0.3 }),
  },
  WING_BACK: {
    role: 'WING_BACK', label: 'Wing-back', positions: ['DL', 'DR', 'ML', 'MR'], duty: 'SUPPORT', complexity: 2,
    description: 'Covers the whole flank, providing width in attack and cover in defence.',
    keyAttributes: ['stamina', 'pace', 'crossing', 'tackling', 'workRate'],
    emphasis: e({ defending: 0.5, width: 0.9, transition: 0.4, pressing: 0.4, creation: 0.2 }),
  },
  INVERTED_FULL_BACK: {
    role: 'INVERTED_FULL_BACK', label: 'Inverted full-back', positions: ['DL', 'DR'], duty: 'SUPPORT', complexity: 3,
    description: 'Steps into midfield in possession to overload the centre.',
    keyAttributes: ['passing', 'decisions', 'firstTouch', 'tackling', 'teamwork'],
    emphasis: e({ defending: 0.55, buildUp: 0.6, creation: 0.25, width: -0.2 }),
  },
  ATTACKING_FULL_BACK: {
    role: 'ATTACKING_FULL_BACK', label: 'Attacking full-back', positions: ['DL', 'DR'], duty: 'ATTACK', complexity: 2,
    description: 'Pushes high and early, accepting space behind.',
    keyAttributes: ['pace', 'crossing', 'stamina', 'dribbling', 'acceleration'],
    emphasis: e({ defending: 0.3, width: 1.0, creation: 0.35, transition: 0.35 }),
  },

  CENTRAL_DEFENDER: {
    role: 'CENTRAL_DEFENDER', label: 'Central defender', positions: ['DC'], duty: 'DEFEND', complexity: 1,
    description: 'Holds position, marks his man and clears danger.',
    keyAttributes: ['marking', 'tackling', 'heading', 'positioning', 'strength'],
    emphasis: e({ defending: 1.0, aerial: 0.7 }),
  },
  BALL_PLAYING_DEFENDER: {
    role: 'BALL_PLAYING_DEFENDER', label: 'Ball-playing defender', positions: ['DC'], duty: 'DEFEND', complexity: 2,
    description: 'Defends the box and breaks lines with passing from the back.',
    keyAttributes: ['passing', 'composure', 'vision', 'marking', 'heading'],
    emphasis: e({ defending: 0.9, aerial: 0.6, buildUp: 0.7 }),
  },
  STOPPER: {
    role: 'STOPPER', label: 'Stopper', positions: ['DC'], duty: 'DEFEND', complexity: 2,
    description: 'Steps out aggressively to meet the ball ahead of the line.',
    keyAttributes: ['tackling', 'anticipation', 'strength', 'determination', 'heading'],
    emphasis: e({ defending: 0.95, aerial: 0.75, pressing: 0.5 }),
  },
  COVER_DEFENDER: {
    role: 'COVER_DEFENDER', label: 'Cover defender', positions: ['DC'], duty: 'DEFEND', complexity: 2,
    description: 'Drops to protect the space in behind and sweep up through balls.',
    keyAttributes: ['pace', 'anticipation', 'positioning', 'concentration', 'marking'],
    emphasis: e({ defending: 1.0, transition: 0.35, aerial: 0.45 }),
  },
  WIDE_CENTRE_BACK: {
    role: 'WIDE_CENTRE_BACK', label: 'Wide centre-back', positions: ['DC'], duty: 'SUPPORT', complexity: 3,
    description: 'The outer defender of a back three, stepping into the channel.',
    keyAttributes: ['pace', 'tackling', 'passing', 'stamina', 'marking'],
    emphasis: e({ defending: 0.8, width: 0.35, buildUp: 0.4, aerial: 0.5 }),
  },

  ANCHOR: {
    role: 'ANCHOR', label: 'Anchor man', positions: ['DM', 'MC'], duty: 'DEFEND', complexity: 1,
    description: 'Screens the back line and never leaves the space in front of it.',
    keyAttributes: ['positioning', 'tackling', 'concentration', 'anticipation', 'teamwork'],
    emphasis: e({ defending: 0.9, pressing: 0.3, buildUp: 0.3 }),
  },
  DEEP_LYING_PLAYMAKER: {
    role: 'DEEP_LYING_PLAYMAKER', label: 'Deep-lying playmaker', positions: ['DM', 'MC'], duty: 'SUPPORT', complexity: 2,
    description: 'Sits deep and dictates tempo with the ball.',
    keyAttributes: ['passing', 'vision', 'composure', 'decisions', 'firstTouch'],
    emphasis: e({ defending: 0.45, buildUp: 1.0, creation: 0.6 }),
  },
  BALL_WINNING_MIDFIELDER: {
    role: 'BALL_WINNING_MIDFIELDER', label: 'Ball-winning midfielder', positions: ['DM', 'MC'], duty: 'DEFEND', complexity: 1,
    description: 'Hunts the ball and breaks up play, accepting fouls.',
    keyAttributes: ['tackling', 'workRate', 'stamina', 'determination', 'anticipation'],
    emphasis: e({ defending: 0.8, pressing: 1.0, transition: 0.3 }),
  },
  HALF_BACK: {
    role: 'HALF_BACK', label: 'Half-back', positions: ['DM'], duty: 'DEFEND', complexity: 3,
    description: 'Drops between the centre-backs to make a back three in possession.',
    keyAttributes: ['positioning', 'passing', 'tackling', 'teamwork', 'concentration'],
    emphasis: e({ defending: 0.9, buildUp: 0.7 }),
  },

  CENTRAL_MIDFIELDER: {
    role: 'CENTRAL_MIDFIELDER', label: 'Central midfielder', positions: ['MC', 'DM'], duty: 'SUPPORT', complexity: 1,
    description: 'A balanced presence linking defence and attack.',
    keyAttributes: ['passing', 'decisions', 'teamwork', 'stamina', 'firstTouch'],
    emphasis: e({ defending: 0.5, buildUp: 0.6, creation: 0.4, pressing: 0.4 }),
  },
  BOX_TO_BOX: {
    role: 'BOX_TO_BOX', label: 'Box-to-box midfielder', positions: ['MC'], duty: 'SUPPORT', complexity: 2,
    description: 'Covers ground relentlessly and arrives in both boxes.',
    keyAttributes: ['stamina', 'workRate', 'determination', 'tackling', 'longShots'],
    emphasis: e({ defending: 0.55, pressing: 0.7, transition: 0.6, finishing: 0.3, buildUp: 0.3 }),
  },
  MEZZALA: {
    role: 'MEZZALA', label: 'Mezzala', positions: ['MC'], duty: 'ATTACK', complexity: 3,
    description: 'Drifts into the half-space to create and arrive late.',
    keyAttributes: ['dribbling', 'vision', 'passing', 'acceleration', 'decisions'],
    emphasis: e({ creation: 0.8, buildUp: 0.35, finishing: 0.3, width: 0.25, defending: 0.2 }),
  },
  ROAMING_PLAYMAKER: {
    role: 'ROAMING_PLAYMAKER', label: 'Roaming playmaker', positions: ['MC'], duty: 'SUPPORT', complexity: 3,
    description: 'Moves anywhere to find the ball and set the rhythm.',
    keyAttributes: ['vision', 'passing', 'firstTouch', 'stamina', 'decisions'],
    emphasis: e({ buildUp: 0.8, creation: 0.8, pressing: 0.3, defending: 0.2 }),
  },
  CARRILERO: {
    role: 'CARRILERO', label: 'Carrilero', positions: ['MC'], duty: 'SUPPORT', complexity: 3,
    description: 'Shuttles into the channel to connect midfield and flank.',
    keyAttributes: ['teamwork', 'positioning', 'stamina', 'passing', 'tackling'],
    emphasis: e({ defending: 0.5, buildUp: 0.5, width: 0.35, pressing: 0.35 }),
  },

  ATTACKING_MIDFIELDER: {
    role: 'ATTACKING_MIDFIELDER', label: 'Attacking midfielder', positions: ['AM', 'MC'], duty: 'ATTACK', complexity: 1,
    description: 'Operates between the lines looking for the final pass.',
    keyAttributes: ['vision', 'passing', 'firstTouch', 'composure', 'longShots'],
    emphasis: e({ creation: 0.9, finishing: 0.35, buildUp: 0.2 }),
  },
  ADVANCED_PLAYMAKER: {
    role: 'ADVANCED_PLAYMAKER', label: 'Advanced playmaker', positions: ['AM', 'MC', 'AML', 'AMR'], duty: 'ATTACK', complexity: 2,
    description: 'The focal point of creation in the final third.',
    keyAttributes: ['vision', 'passing', 'dribbling', 'composure', 'decisions'],
    emphasis: e({ creation: 1.0, buildUp: 0.35, finishing: 0.25 }),
  },
  SHADOW_STRIKER: {
    role: 'SHADOW_STRIKER', label: 'Shadow striker', positions: ['AM'], duty: 'ATTACK', complexity: 2,
    description: 'Runs beyond the striker into the box.',
    keyAttributes: ['finishing', 'anticipation', 'acceleration', 'composure', 'longShots'],
    emphasis: e({ finishing: 0.9, creation: 0.35, transition: 0.4, pressing: 0.3 }),
  },

  WINGER: {
    role: 'WINGER', label: 'Winger', positions: ['AML', 'AMR', 'ML', 'MR'], duty: 'ATTACK', complexity: 1,
    description: 'Stays wide, takes on the full-back and delivers.',
    keyAttributes: ['crossing', 'dribbling', 'pace', 'acceleration', 'agility'],
    emphasis: e({ width: 1.0, creation: 0.6, transition: 0.4, finishing: 0.2 }),
  },
  INVERTED_WINGER: {
    role: 'INVERTED_WINGER', label: 'Inverted winger', positions: ['AML', 'AMR'], duty: 'ATTACK', complexity: 2,
    description: 'Cuts inside onto the stronger foot to shoot and combine.',
    keyAttributes: ['dribbling', 'finishing', 'acceleration', 'longShots', 'agility'],
    emphasis: e({ width: 0.45, creation: 0.55, finishing: 0.7, transition: 0.35 }),
  },
  WIDE_PLAYMAKER: {
    role: 'WIDE_PLAYMAKER', label: 'Wide playmaker', positions: ['AML', 'AMR', 'ML', 'MR'], duty: 'SUPPORT', complexity: 3,
    description: 'Drifts inside to dictate play from the flank.',
    keyAttributes: ['passing', 'vision', 'firstTouch', 'dribbling', 'teamwork'],
    emphasis: e({ creation: 0.9, buildUp: 0.5, width: 0.35 }),
  },
  WIDE_TARGET_MAN: {
    role: 'WIDE_TARGET_MAN', label: 'Wide target forward', positions: ['AML', 'AMR', 'ML', 'MR'], duty: 'SUPPORT', complexity: 2,
    description: 'A physical out-ball on the flank who holds it up.',
    keyAttributes: ['strength', 'heading', 'firstTouch', 'balance', 'crossing'],
    emphasis: e({ width: 0.7, aerial: 0.7, buildUp: 0.35, finishing: 0.3 }),
  },

  ADVANCED_FORWARD: {
    role: 'ADVANCED_FORWARD', label: 'Advanced forward', positions: ['ST'], duty: 'ATTACK', complexity: 1,
    description: 'Leads the line and runs at the last defender.',
    keyAttributes: ['finishing', 'pace', 'composure', 'acceleration', 'dribbling'],
    emphasis: e({ finishing: 1.0, transition: 0.5, pressing: 0.3 }),
  },
  TARGET_MAN: {
    role: 'TARGET_MAN', label: 'Target man', positions: ['ST'], duty: 'ATTACK', complexity: 1,
    description: 'The out-ball: wins headers and brings others into play.',
    keyAttributes: ['heading', 'strength', 'balance', 'firstTouch', 'finishing'],
    emphasis: e({ finishing: 0.7, aerial: 1.0, buildUp: 0.35 }),
  },
  POACHER: {
    role: 'POACHER', label: 'Poacher', positions: ['ST'], duty: 'ATTACK', complexity: 1,
    description: 'Does nothing but occupy the box and finish.',
    keyAttributes: ['finishing', 'anticipation', 'composure', 'positioning', 'acceleration'],
    emphasis: e({ finishing: 1.1 }),
  },
  COMPLETE_FORWARD: {
    role: 'COMPLETE_FORWARD', label: 'Complete forward', positions: ['ST'], duty: 'ATTACK', complexity: 3,
    description: 'Scores, creates, presses and holds the ball up.',
    keyAttributes: ['finishing', 'passing', 'strength', 'dribbling', 'vision'],
    emphasis: e({ finishing: 0.85, creation: 0.55, aerial: 0.5, pressing: 0.4, buildUp: 0.3 }),
  },
  FALSE_NINE: {
    role: 'FALSE_NINE', label: 'False nine', positions: ['ST'], duty: 'SUPPORT', complexity: 3,
    description: 'Drops off the line to create an extra midfielder.',
    keyAttributes: ['vision', 'passing', 'firstTouch', 'dribbling', 'composure'],
    emphasis: e({ creation: 0.9, buildUp: 0.55, finishing: 0.45 }),
  },
  PRESSING_FORWARD: {
    role: 'PRESSING_FORWARD', label: 'Pressing forward', positions: ['ST'], duty: 'SUPPORT', complexity: 2,
    description: 'Starts the press and harries defenders relentlessly.',
    keyAttributes: ['workRate', 'stamina', 'determination', 'anticipation', 'finishing'],
    emphasis: e({ pressing: 1.1, finishing: 0.55, transition: 0.35 }),
  },
};

export const ROLE_LIST = Object.values(ROLE_DEFINITIONS);

export function rolesForPosition(position: Position): RoleDefinition[] {
  return ROLE_LIST.filter((r) => r.positions.includes(position));
}

export function isRoleValidForPosition(role: PlayerRole, position: Position): boolean {
  return ROLE_DEFINITIONS[role].positions.includes(position);
}
