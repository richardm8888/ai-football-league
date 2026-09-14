import type { Formation, PlayerRole, Position } from '../types';
import { ROLE_DEFINITIONS, rolesForPosition } from './roles';

/**
 * A slot is one shirt on the pitch. `x` runs 0 (left touchline) to 100 (right),
 * `y` runs 0 (own goal line) to 100 (opposition goal line), which is all the UI
 * needs to draw a pitch at any screen size.
 */
export interface FormationSlot {
  key: string;
  label: string;
  position: Position;
  x: number;
  y: number;
  defaultRole: PlayerRole;
  /** Which vertical band the slot defends and attacks in. */
  band: 'GK' | 'DEFENCE' | 'MIDFIELD' | 'ATTACK';
  /** Which side of the pitch the slot occupies. */
  channel: 'LEFT' | 'CENTRE' | 'RIGHT';
}

export interface FormationDefinition {
  formation: Formation;
  label: string;
  shape: string;
  description: string;
  slots: FormationSlot[];
  /** Structural traits the engine reads directly. */
  traits: {
    defenders: number;
    midfielders: number;
    attackers: number;
    backThree: boolean;
    naturalWidth: number;   // 0-100, how much natural width the shape gives
    centralDensity: number; // 0-100, bodies in the middle
  };
}

const slot = (
  key: string, label: string, position: Position, x: number, y: number,
  band: FormationSlot['band'], defaultRole: PlayerRole,
): FormationSlot => ({
  key, label, position, x, y, band, defaultRole,
  channel: x < 33 ? 'LEFT' : x > 67 ? 'RIGHT' : 'CENTRE',
});

export const FORMATION_DEFINITIONS: Record<Formation, FormationDefinition> = {
  F_4_3_3: {
    formation: 'F_4_3_3', label: '4-3-3', shape: '4-3-3',
    description: 'A front three with a three-man midfield. Good width and high pressing triggers.',
    traits: { defenders: 4, midfielders: 3, attackers: 3, backThree: false, naturalWidth: 72, centralDensity: 58 },
    slots: [
      slot('GK', 'GK', 'GK', 50, 4, 'GK', 'GOALKEEPER'),
      slot('DL', 'LB', 'DL', 12, 22, 'DEFENCE', 'FULL_BACK'),
      slot('DCL', 'LCB', 'DC', 36, 18, 'DEFENCE', 'CENTRAL_DEFENDER'),
      slot('DCR', 'RCB', 'DC', 64, 18, 'DEFENCE', 'CENTRAL_DEFENDER'),
      slot('DR', 'RB', 'DR', 88, 22, 'DEFENCE', 'FULL_BACK'),
      slot('DM', 'DM', 'DM', 50, 38, 'MIDFIELD', 'DEEP_LYING_PLAYMAKER'),
      slot('MCL', 'LCM', 'MC', 32, 52, 'MIDFIELD', 'BOX_TO_BOX'),
      slot('MCR', 'RCM', 'MC', 68, 52, 'MIDFIELD', 'CENTRAL_MIDFIELDER'),
      slot('AML', 'LW', 'AML', 14, 76, 'ATTACK', 'WINGER'),
      slot('STC', 'ST', 'ST', 50, 86, 'ATTACK', 'ADVANCED_FORWARD'),
      slot('AMR', 'RW', 'AMR', 86, 76, 'ATTACK', 'WINGER'),
    ],
  },
  F_4_2_3_1: {
    formation: 'F_4_2_3_1', label: '4-2-3-1', shape: '4-2-3-1',
    description: 'A double pivot behind a creative band of three. Solid but needs a lone striker to hold up play.',
    traits: { defenders: 4, midfielders: 5, attackers: 1, backThree: false, naturalWidth: 66, centralDensity: 68 },
    slots: [
      slot('GK', 'GK', 'GK', 50, 4, 'GK', 'GOALKEEPER'),
      slot('DL', 'LB', 'DL', 12, 22, 'DEFENCE', 'FULL_BACK'),
      slot('DCL', 'LCB', 'DC', 36, 18, 'DEFENCE', 'CENTRAL_DEFENDER'),
      slot('DCR', 'RCB', 'DC', 64, 18, 'DEFENCE', 'CENTRAL_DEFENDER'),
      slot('DR', 'RB', 'DR', 88, 22, 'DEFENCE', 'FULL_BACK'),
      slot('DML', 'LDM', 'DM', 38, 38, 'MIDFIELD', 'BALL_WINNING_MIDFIELDER'),
      slot('DMR', 'RDM', 'DM', 62, 38, 'MIDFIELD', 'DEEP_LYING_PLAYMAKER'),
      slot('AML', 'LW', 'AML', 14, 68, 'ATTACK', 'INVERTED_WINGER'),
      slot('AMC', 'AM', 'AM', 50, 66, 'ATTACK', 'ADVANCED_PLAYMAKER'),
      slot('AMR', 'RW', 'AMR', 86, 68, 'ATTACK', 'INVERTED_WINGER'),
      slot('STC', 'ST', 'ST', 50, 88, 'ATTACK', 'COMPLETE_FORWARD'),
    ],
  },
  F_4_4_2: {
    formation: 'F_4_4_2', label: '4-4-2', shape: '4-4-2',
    description: 'Two banks of four and a strike partnership. Simple to organise, easy to overrun centrally.',
    traits: { defenders: 4, midfielders: 4, attackers: 2, backThree: false, naturalWidth: 70, centralDensity: 50 },
    slots: [
      slot('GK', 'GK', 'GK', 50, 4, 'GK', 'GOALKEEPER'),
      slot('DL', 'LB', 'DL', 12, 22, 'DEFENCE', 'FULL_BACK'),
      slot('DCL', 'LCB', 'DC', 36, 18, 'DEFENCE', 'CENTRAL_DEFENDER'),
      slot('DCR', 'RCB', 'DC', 64, 18, 'DEFENCE', 'CENTRAL_DEFENDER'),
      slot('DR', 'RB', 'DR', 88, 22, 'DEFENCE', 'FULL_BACK'),
      slot('ML', 'LM', 'ML', 12, 52, 'MIDFIELD', 'WINGER'),
      slot('MCL', 'LCM', 'MC', 38, 48, 'MIDFIELD', 'BALL_WINNING_MIDFIELDER'),
      slot('MCR', 'RCM', 'MC', 62, 48, 'MIDFIELD', 'CENTRAL_MIDFIELDER'),
      slot('MR', 'RM', 'MR', 88, 52, 'MIDFIELD', 'WINGER'),
      slot('STCL', 'LST', 'ST', 40, 84, 'ATTACK', 'TARGET_MAN'),
      slot('STCR', 'RST', 'ST', 60, 84, 'ATTACK', 'ADVANCED_FORWARD'),
    ],
  },
  F_3_5_2: {
    formation: 'F_3_5_2', label: '3-5-2', shape: '3-5-2',
    description: 'A back three with wing-backs providing all the width. Dominates midfield, exposed if the wing-backs are beaten.',
    traits: { defenders: 3, midfielders: 5, attackers: 2, backThree: true, naturalWidth: 64, centralDensity: 76 },
    slots: [
      slot('GK', 'GK', 'GK', 50, 4, 'GK', 'GOALKEEPER'),
      slot('DCL', 'LCB', 'DC', 28, 18, 'DEFENCE', 'WIDE_CENTRE_BACK'),
      slot('DC', 'CB', 'DC', 50, 15, 'DEFENCE', 'CENTRAL_DEFENDER'),
      slot('DCR', 'RCB', 'DC', 72, 18, 'DEFENCE', 'WIDE_CENTRE_BACK'),
      slot('WBL', 'LWB', 'DL', 8, 48, 'MIDFIELD', 'WING_BACK'),
      slot('MCL', 'LCM', 'MC', 34, 46, 'MIDFIELD', 'BOX_TO_BOX'),
      slot('MC', 'CM', 'MC', 50, 40, 'MIDFIELD', 'DEEP_LYING_PLAYMAKER'),
      slot('MCR', 'RCM', 'MC', 66, 46, 'MIDFIELD', 'CENTRAL_MIDFIELDER'),
      slot('WBR', 'RWB', 'DR', 92, 48, 'MIDFIELD', 'WING_BACK'),
      slot('STCL', 'LST', 'ST', 40, 84, 'ATTACK', 'ADVANCED_FORWARD'),
      slot('STCR', 'RST', 'ST', 60, 84, 'ATTACK', 'TARGET_MAN'),
    ],
  },
  F_5_3_2: {
    formation: 'F_5_3_2', label: '5-3-2', shape: '5-3-2',
    description: 'The 3-5-2 with the wing-backs held deep. Very hard to break down, relies on transitions.',
    traits: { defenders: 5, midfielders: 3, attackers: 2, backThree: true, naturalWidth: 52, centralDensity: 70 },
    slots: [
      slot('GK', 'GK', 'GK', 50, 4, 'GK', 'GOALKEEPER'),
      slot('WBL', 'LWB', 'DL', 10, 26, 'DEFENCE', 'FULL_BACK'),
      slot('DCL', 'LCB', 'DC', 30, 16, 'DEFENCE', 'CENTRAL_DEFENDER'),
      slot('DC', 'CB', 'DC', 50, 14, 'DEFENCE', 'COVER_DEFENDER'),
      slot('DCR', 'RCB', 'DC', 70, 16, 'DEFENCE', 'CENTRAL_DEFENDER'),
      slot('WBR', 'RWB', 'DR', 90, 26, 'DEFENCE', 'FULL_BACK'),
      slot('MCL', 'LCM', 'MC', 34, 48, 'MIDFIELD', 'BALL_WINNING_MIDFIELDER'),
      slot('MC', 'CM', 'MC', 50, 44, 'MIDFIELD', 'CENTRAL_MIDFIELDER'),
      slot('MCR', 'RCM', 'MC', 66, 48, 'MIDFIELD', 'BOX_TO_BOX'),
      slot('STCL', 'LST', 'ST', 40, 82, 'ATTACK', 'ADVANCED_FORWARD'),
      slot('STCR', 'RST', 'ST', 60, 82, 'ATTACK', 'POACHER'),
    ],
  },
};

export const FORMATION_LIST = Object.values(FORMATION_DEFINITIONS);

export function getFormation(formation: Formation): FormationDefinition {
  return FORMATION_DEFINITIONS[formation];
}

export function getSlot(formation: Formation, slotKey: string): FormationSlot | undefined {
  return FORMATION_DEFINITIONS[formation].slots.find((s) => s.key === slotKey);
}

/** Roles the UI should offer for a slot, always including the slot's default. */
export function allowedRolesForSlot(formation: Formation, slotKey: string): PlayerRole[] {
  const s = getSlot(formation, slotKey);
  if (!s) return [];
  const roles = rolesForPosition(s.position).map((r) => r.role);
  return roles.includes(s.defaultRole) ? roles : [s.defaultRole, ...roles];
}

/**
 * How far apart two formations are, 0-1. Used to price tactical changes: moving
 * from 4-3-3 to 4-2-3-1 keeps the back four and is cheap; 4-3-3 to 3-5-2
 * rebuilds the defence and is not.
 */
export function formationDistance(a: Formation, b: Formation): number {
  if (a === b) return 0;
  const ta = FORMATION_DEFINITIONS[a].traits;
  const tb = FORMATION_DEFINITIONS[b].traits;
  const lineChange =
    Math.abs(ta.defenders - tb.defenders) +
    Math.abs(ta.midfielders - tb.midfielders) +
    Math.abs(ta.attackers - tb.attackers);
  const backLineRebuild = ta.backThree !== tb.backThree ? 2 : 0;
  const widthShift = Math.abs(ta.naturalWidth - tb.naturalWidth) / 100;
  return Math.min(1, (lineChange + backLineRebuild) / 8 + widthShift * 0.25);
}

/** Positions a formation needs, useful for squad generation and warnings. */
export function requiredPositions(formation: Formation): Position[] {
  return FORMATION_DEFINITIONS[formation].slots.map((s) => s.position);
}

export function defaultRoleAssignments(formation: Formation): Array<{ slot: string; position: Position; role: PlayerRole }> {
  return FORMATION_DEFINITIONS[formation].slots.map((s) => ({
    slot: s.key,
    position: s.position,
    role: ROLE_DEFINITIONS[s.defaultRole].role,
  }));
}
