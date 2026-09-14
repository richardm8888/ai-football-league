import type { ClubFamiliarity } from '@/domain/familiarity';
import type { LineupSelectionInput, TacticalPlanInput } from '@/domain/schemas';
import type { PlayerAttributes, Position } from '@/domain/types';

/** The squad view the tactics editor works with. Private to the owning manager. */
export interface EditorPlayer {
  id: string;
  name: string;
  lastName: string;
  shirtNumber: number;
  primaryPosition: Position;
  secondaryPositions: Position[];
  attributes: PlayerAttributes;
  overall: number;
  fitness: number;
  form: number;
  injured: boolean;
  injuryDescription: string | null;
  suspended: boolean;
}

export interface TacticsEditorProps {
  fixtureId: string;
  clubId: string;
  opponentName: string;
  venue: 'HOME' | 'AWAY';
  phase: string;
  planStatus: 'DRAFT' | 'PROPOSED' | 'APPROVED' | 'LOCKED';
  editable: boolean;
  lockable: boolean;
  initialTactics: TacticalPlanInput;
  initialLineup: LineupSelectionInput;
  players: EditorPlayer[];
  familiarity: ClubFamiliarity;
  previousPlan: TacticalPlanInput | null;
}
