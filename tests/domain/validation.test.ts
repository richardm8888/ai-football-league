import { describe, expect, it } from 'vitest';
import { matchPlanSchema, trainingPlanSchema } from '@/domain/schemas';
import { FORMATION_LIST, getFormation } from '@/domain/tactics/formations';
import { isRoleValidForPosition, ROLE_DEFINITIONS } from '@/domain/tactics/roles';
import { autoSelectLineup, defaultTacticalPlan } from '@/domain/tactics/selection';
import {
  canEditPlans, canLockPlan, validateLineup, validateMatchPlan,
  validateSubstitutionPlan, validateTactics, validateTrainingPlan,
  type SquadPlayerView,
} from '@/domain/validation';
import { makeClub } from '../helpers/factory';

const club = makeClub('validation', 66);
const squadView: SquadPlayerView[] = club.selectable.map((p) => ({
  id: p.id, name: p.name, primaryPosition: p.primaryPosition,
  secondaryPositions: p.secondaryPositions, fitness: Math.round(p.fitness),
  injured: false, injuryDescription: null, suspended: false,
}));

const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);

describe('formation and role definitions', () => {
  it('every formation fields exactly eleven distinct slots', () => {
    for (const formation of FORMATION_LIST) {
      expect(formation.slots).toHaveLength(11);
      expect(new Set(formation.slots.map((s) => s.key)).size).toBe(11);
    }
  });

  it('every formation has exactly one goalkeeper', () => {
    for (const formation of FORMATION_LIST) {
      expect(formation.slots.filter((s) => s.position === 'GK')).toHaveLength(1);
    }
  });

  it('every slot default role is legal for that slot position', () => {
    for (const formation of FORMATION_LIST) {
      for (const slot of formation.slots) {
        expect(isRoleValidForPosition(slot.defaultRole, slot.position)).toBe(true);
      }
    }
  });

  it('every role is playable somewhere', () => {
    for (const role of Object.values(ROLE_DEFINITIONS)) {
      expect(role.positions.length).toBeGreaterThan(0);
    }
  });
});

describe('line-up validation', () => {
  const tactics = defaultTacticalPlan('F_4_3_3');
  const lineup = autoSelectLineup(club.selectable, 'F_4_3_3');

  it('accepts a sensible automatically selected side', () => {
    const result = validateLineup(lineup, tactics, squadView);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a player who is not in the squad', () => {
    const broken = {
      ...lineup,
      starters: lineup.starters.map((s, i) => (i === 5 ? { ...s, playerId: 'not-a-player' } : s)),
    };
    expect(codes(validateLineup(broken, tactics, squadView).errors)).toContain('PLAYER_NOT_IN_SQUAD');
  });

  it('rejects the same player twice', () => {
    const duplicated = {
      ...lineup,
      starters: lineup.starters.map((s, i) => (i === 5 ? { ...s, playerId: lineup.starters[4].playerId } : s)),
    };
    expect(codes(validateLineup(duplicated, tactics, squadView).errors)).toContain('PLAYER_DUPLICATED');
  });

  it('rejects an injured or suspended player', () => {
    const injuredSquad = squadView.map((p, i) => (
      i === 0 ? { ...p, injured: true, injuryDescription: 'Hamstring strain' } : p));
    const target = injuredSquad[0].id;
    const withInjured = {
      ...lineup,
      starters: lineup.starters.map((s, i) => (i === 10 ? { ...s, playerId: target } : s)),
    };
    const result = validateLineup(withInjured, tactics, injuredSquad);
    expect(codes(result.errors)).toContain('PLAYER_INJURED');

    const suspendedSquad = squadView.map((p, i) => (i === 0 ? { ...p, suspended: true } : p));
    expect(codes(validateLineup(withInjured, tactics, suspendedSquad).errors)).toContain('PLAYER_SUSPENDED');
  });

  it('rejects an outfielder in goal and a goalkeeper outfield', () => {
    const keeper = squadView.find((p) => p.primaryPosition === 'GK')!;
    const outfielder = squadView.find((p) => p.primaryPosition === 'ST')!;
    const swapped = {
      ...lineup,
      starters: lineup.starters.map((s) => {
        if (s.slot === 'GK') return { ...s, playerId: outfielder.id };
        if (s.playerId === keeper.id) return s;
        if (s.slot === 'STC') return { ...s, playerId: keeper.id };
        return s;
      }),
    };
    const result = validateLineup(swapped, tactics, squadView);
    expect(codes(result.errors)).toContain('NON_KEEPER_IN_GOAL');
    expect(codes(result.errors)).toContain('KEEPER_OUTFIELD');
  });

  it('rejects a role that cannot be played in that slot', () => {
    const wrongRole = {
      ...lineup,
      starters: lineup.starters.map((s) => (s.slot === 'DCL' ? { ...s, role: 'POACHER' as const } : s)),
    };
    expect(codes(validateLineup(wrongRole, tactics, squadView).errors))
      .toContain('ROLE_NOT_VALID_FOR_POSITION');
  });

  it('rejects a slot that does not exist in the chosen formation', () => {
    const wrongSlot = {
      ...lineup,
      starters: lineup.starters.map((s, i) => (i === 0 ? { ...s, slot: 'WBL' } : s)),
    };
    const result = validateLineup(wrongSlot, tactics, squadView);
    expect(codes(result.errors)).toContain('SLOT_NOT_IN_FORMATION');
    expect(codes(result.errors)).toContain('SLOT_EMPTY');
  });

  it('blocks a player who is too unfit to start but only warns when they are merely tired', () => {
    const unfit = squadView.map((p) => (
      p.id === lineup.starters[3].playerId ? { ...p, fitness: 30 } : p));
    expect(codes(validateLineup(lineup, tactics, unfit).errors)).toContain('PLAYER_UNFIT');

    const tired = squadView.map((p) => (
      p.id === lineup.starters[3].playerId ? { ...p, fitness: 55 } : p));
    const result = validateLineup(lineup, tactics, tired);
    expect(result.ok).toBe(true);
    expect(codes(result.warnings)).toContain('PLAYER_LOW_FITNESS');
  });

  it('warns rather than blocks when a player is out of position', () => {
    const striker = squadView.find((p) => p.primaryPosition === 'ST'
      && !p.secondaryPositions.includes('DC'))!;
    const makeshift = {
      ...lineup,
      starters: lineup.starters.map((s) => (s.slot === 'DCL' ? { ...s, playerId: striker.id } : s)),
      bench: lineup.bench.filter((b) => b.playerId !== striker.id),
    };
    const result = validateLineup(makeshift, tactics, squadView);
    const warningCodes = codes(result.warnings);
    expect(warningCodes.some((c) => c === 'PLAYER_OUT_OF_POSITION' || c === 'PLAYER_AWKWARD_POSITION')).toBe(true);
  });

  it('warns about a thin bench and a missing reserve goalkeeper', () => {
    const thin = { ...lineup, bench: lineup.bench.filter((b) => {
      const player = squadView.find((p) => p.id === b.playerId);
      return player?.primaryPosition !== 'GK';
    }).slice(0, 2) };
    const warningCodes = codes(validateLineup(thin, tactics, squadView).warnings);
    expect(warningCodes).toContain('BENCH_TOO_SMALL');
    expect(warningCodes).toContain('NO_BACKUP_KEEPER');
  });
});

describe('tactical option compatibility', () => {
  const base = defaultTacticalPlan();

  it('accepts a coherent plan', () => {
    expect(validateTactics(base).ok).toBe(true);
  });

  it('rejects genuinely contradictory instructions', () => {
    expect(codes(validateTactics({ ...base, defensiveApproach: 'AGGRESSIVE_PRESSING', pressing: 'LOW' }).errors))
      .toContain('PRESSING_CONTRADICTION');
    expect(codes(validateTactics({ ...base, defensiveApproach: 'LOW_BLOCK', pressing: 'INTENSE' }).errors))
      .toContain('BLOCK_CONTRADICTION');
    expect(codes(validateTactics({ ...base, defensiveApproach: 'LOW_BLOCK', defensiveLine: 'VERY_HIGH' }).errors))
      .toContain('LINE_CONTRADICTION');
    expect(codes(validateTactics({ ...base, offsideTrap: true, defensiveLine: 'DEEP' }).errors))
      .toContain('OFFSIDE_TRAP_DEEP');
  });

  it('warns about unusual but legal combinations without blocking them', () => {
    const result = validateTactics({ ...base, playingStyle: 'POSSESSION', buildUp: 'LONG_DISTRIBUTION' });
    expect(result.ok).toBe(true);
    expect(codes(result.warnings)).toContain('STYLE_BUILDUP_MISMATCH');
  });

  it('rejects two instructions firing on the same trigger', () => {
    const result = validateTactics({
      ...base,
      matchStateInstructions: [
        { trigger: 'TRAILING', adjustment: 'MORE_ATTACKING', fromMinute: 60, note: '' },
        { trigger: 'TRAILING', adjustment: 'GO_DIRECT', fromMinute: 70, note: '' },
      ],
    });
    expect(codes(result.errors)).toContain('DUPLICATE_TRIGGER');
  });
});

describe('substitution plan validation', () => {
  const tactics = defaultTacticalPlan('F_4_3_3');
  const lineup = autoSelectLineup(club.selectable, 'F_4_3_3');

  it('rejects taking off a player who is not starting', () => {
    const plan = {
      ...tactics,
      substitutionPlan: [{
        outPlayerId: lineup.bench[0].playerId,
        inPlayerId: lineup.bench[1].playerId,
        minute: 60, condition: 'ALWAYS' as const,
      }],
    };
    expect(codes(validateSubstitutionPlan(plan, lineup, squadView).errors)).toContain('SUB_OUT_NOT_STARTING');
  });

  it('rejects bringing on a player who is not on the bench', () => {
    const notNamed = squadView.find((p) =>
      !lineup.starters.some((s) => s.playerId === p.id)
      && !lineup.bench.some((b) => b.playerId === p.id))!;
    const plan = {
      ...tactics,
      substitutionPlan: [{
        outPlayerId: lineup.starters[9].playerId,
        inPlayerId: notNamed.id,
        minute: 60, condition: 'ALWAYS' as const,
      }],
    };
    expect(codes(validateSubstitutionPlan(plan, lineup, squadView).errors)).toContain('SUB_IN_NOT_ON_BENCH');
  });

  it('rejects substituting the same player twice', () => {
    const plan = {
      ...tactics,
      substitutionPlan: [
        { outPlayerId: lineup.starters[9].playerId, inPlayerId: lineup.bench[0].playerId, minute: 60, condition: 'ALWAYS' as const },
        { outPlayerId: lineup.starters[9].playerId, inPlayerId: lineup.bench[1].playerId, minute: 70, condition: 'ALWAYS' as const },
      ],
    };
    expect(codes(validateSubstitutionPlan(plan, lineup, squadView).errors)).toContain('SUB_OUT_TWICE');
  });
});

describe('training plan validation', () => {
  const base = {
    primaryFocus: 'PRESSING' as const,
    secondaryFocus: 'RECOVERY' as const,
    intensity: 'NORMAL' as const,
    targetFormation: null,
    individualFocus: [],
    notes: '',
  };

  it('rejects the same focus twice', () => {
    const parsed = trainingPlanSchema.safeParse({ ...base, secondaryFocus: 'PRESSING' });
    expect(parsed.success).toBe(false);
  });

  it('rejects individual work on a player outside the squad', () => {
    const result = validateTrainingPlan(
      { ...base, individualFocus: [{ playerId: 'nobody', role: 'ANCHOR' }] }, squadView);
    expect(codes(result.errors)).toContain('PLAYER_NOT_IN_SQUAD');
  });

  it('warns when very high intensity is run with no recovery work', () => {
    const result = validateTrainingPlan(
      { ...base, secondaryFocus: 'TRANSITION_PLAY', intensity: 'VERY_HIGH' }, squadView);
    expect(result.ok).toBe(true);
    expect(codes(result.warnings)).toContain('HIGH_INJURY_RISK');
  });

  it('warns when a tired squad is pushed hard', () => {
    const tired = squadView.map((p) => ({ ...p, fitness: 55 }));
    const result = validateTrainingPlan(
      { ...base, secondaryFocus: 'TRANSITION_PLAY', intensity: 'VERY_HIGH' }, tired);
    expect(codes(result.warnings)).toContain('SQUAD_TOO_TIRED');
  });
});

describe('matchday phase gates', () => {
  it('allows editing while the week is open and blocks it afterwards', () => {
    expect(canEditPlans('PREPARATION', 'DRAFT').ok).toBe(true);
    expect(canEditPlans('REVIEW_AND_APPROVAL', 'APPROVED').ok).toBe(true);
    expect(canEditPlans('LOCKED', 'APPROVED').ok).toBe(false);
    expect(canEditPlans('SIMULATION', 'APPROVED').ok).toBe(false);
    expect(canEditPlans('POST_MATCH', 'APPROVED').ok).toBe(false);
  });

  it('never allows editing a locked plan, whatever the phase', () => {
    const result = canEditPlans('PREPARATION', 'LOCKED');
    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toContain('PLAN_LOCKED');
  });

  it('allows locking whenever the matchday is still open', () => {
    expect(canLockPlan('WEEK_OPEN').ok).toBe(true);
    expect(canLockPlan('TACTICAL_SUBMISSION').ok).toBe(true);
    expect(canLockPlan('SIMULATION').ok).toBe(false);
  });
});

describe('whole plan validation', () => {
  it('parses and accepts a default plan for every formation', () => {
    for (const formation of FORMATION_LIST) {
      const tactics = defaultTacticalPlan(formation.formation);
      const lineup = autoSelectLineup(club.selectable, formation.formation);
      const parsed = matchPlanSchema.safeParse({ tactics, lineup, notes: '' });
      expect(parsed.success, `${formation.label} plan should parse`).toBe(true);
      if (!parsed.success) continue;
      const result = validateMatchPlan(parsed.data, squadView);
      expect(result.errors, `${formation.label} should validate`).toEqual([]);
      expect(getFormation(formation.formation).slots.map((s) => s.key).sort())
        .toEqual(parsed.data.lineup.starters.map((s) => s.slot).sort());
    }
  });

  it('rejects a line-up with the wrong number of starters at the schema level', () => {
    const tactics = defaultTacticalPlan();
    const lineup = autoSelectLineup(club.selectable, 'F_4_3_3');
    const parsed = matchPlanSchema.safeParse({
      tactics, lineup: { ...lineup, starters: lineup.starters.slice(0, 10) }, notes: '',
    });
    expect(parsed.success).toBe(false);
  });
});
