import { describe, expect, it } from 'vitest';
import {
  describeLineupChange, describeTacticalChange, describeTrainingChange,
} from '@/domain/reports/changes';
import { defaultTacticalPlan } from '@/domain/tactics/selection';
import type { LineupSelectionInput, TrainingPlanInput } from '@/domain/schemas';

/**
 * The staff act on an instruction rather than waiting for a confirmation, so
 * these lines are the manager's only chance to notice a misreading before the
 * match. A change that happened and is not described here is a silent one.
 */

// Built here rather than imported: the default lives in the services layer,
// and this suite must stay free of the database.
function trainingPlan(): TrainingPlanInput {
  return {
    primaryFocus: 'POSSESSION',
    secondaryFocus: 'FITNESS',
    intensity: 'NORMAL',
    targetFormation: null,
    individualFocus: [],
    notes: '',
  };
}

const names: Record<string, string> = { p1: 'Adeyemi', p2: 'Berg', p3: 'Costa' };
const nameOf = (id: string) => names[id] ?? 'a player';

function lineup(starterIds: string[], overrides: Partial<LineupSelectionInput> = {}): LineupSelectionInput {
  return {
    starters: starterIds.map((playerId, i) => ({
      slot: `S${i}`, playerId, role: 'CENTRAL_MIDFIELDER' as const,
    })),
    bench: [],
    ...overrides,
  };
}

describe('describing a tactical change', () => {
  it('names the formation on both sides of the move', () => {
    const before = defaultTacticalPlan('F_4_3_3');
    const after = { ...before, formation: 'F_3_5_2' as const };
    expect(describeTacticalChange(before, after)).toEqual(['Formation 4-3-3 → 3-5-2']);
  });

  it('says nothing when nothing moved', () => {
    const plan = defaultTacticalPlan('F_4_3_3');
    expect(describeTacticalChange(plan, { ...plan })).toEqual([]);
  });

  it('reports every setting that changed, not just the first', () => {
    const before = defaultTacticalPlan('F_4_3_3');
    const after = {
      ...before,
      pressing: 'INTENSE' as const,
      tempo: 'VERY_FAST' as const,
      offsideTrap: !before.offsideTrap,
    };
    const lines = describeTacticalChange(before, after);
    expect(lines).toHaveLength(3);
    expect(lines.some((l) => l.startsWith('Pressing'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Tempo'))).toBe(true);
    expect(lines.some((l) => l.includes('Offside trap'))).toBe(true);
  });

  it('describes a first plan without inventing a previous one', () => {
    expect(describeTacticalChange(null, defaultTacticalPlan('F_4_4_2')))
      .toEqual(['Set up in 4-4-2']);
  });
});

describe('describing a selection change', () => {
  it('names who came in and who dropped out', () => {
    const lines = describeLineupChange(lineup(['p1', 'p2']), lineup(['p1', 'p3']), nameOf);
    expect(lines).toContain('In: Costa');
    expect(lines).toContain('Out: Berg');
  });

  it('reports a player kept in the side but given a different job', () => {
    const before = lineup(['p1']);
    const after: LineupSelectionInput = {
      ...before,
      starters: [{ slot: 'S0', playerId: 'p1', role: 'BALL_WINNING_MIDFIELDER' }],
    };
    const lines = describeLineupChange(before, after, nameOf);
    expect(lines.some((l) => l.startsWith('Adeyemi:'))).toBe(true);
  });

  it('is silent when the same eleven play the same jobs', () => {
    expect(describeLineupChange(lineup(['p1', 'p2']), lineup(['p1', 'p2']), nameOf)).toEqual([]);
  });
});

describe('describing a training change', () => {
  it('reports focus and intensity moves', () => {
    const before = trainingPlan();
    const after = { ...before, primaryFocus: 'PRESSING' as const, intensity: 'HIGH' as const };
    const lines = describeTrainingChange(before, after);
    expect(lines.some((l) => l.includes('pressing'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Intensity'))).toBe(true);
  });

  it('calls out a shape being rehearsed for a future switch', () => {
    const before = trainingPlan();
    const after = { ...before, targetFormation: 'F_3_5_2' as const };
    expect(describeTrainingChange(before, after)).toEqual(['Rehearsing 3-5-2']);
  });
});
