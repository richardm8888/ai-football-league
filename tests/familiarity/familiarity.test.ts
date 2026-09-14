import { describe, expect, it } from 'vitest';
import {
  analyseTacticalChange, emptyClubFamiliarity, executionModifiers, EXECUTION_BAND,
  familiarityFor, overallTacticalStability, positionalFamiliarity, progressFamiliarity,
  UNTRAINED_FAMILIARITY, type ClubFamiliarity, type ExecutionChannel,
} from '@/domain/familiarity';
import type { TacticalPlanInput, TrainingPlanInput } from '@/domain/schemas';
import { defaultTacticalPlan } from '@/domain/tactics/selection';
import { simulateMatch } from '@/engine/engine';
import { buildTeam, makeClub, wellDrilled } from '../helpers/factory';

const training = (over: Partial<TrainingPlanInput> = {}): TrainingPlanInput => ({
  primaryFocus: 'MATCH_PREPARATION',
  secondaryFocus: 'RECOVERY',
  intensity: 'NORMAL',
  targetFormation: null,
  individualFocus: [],
  notes: '',
  ...over,
});

const plan = (over: Partial<TacticalPlanInput> = {}): TacticalPlanInput =>
  ({ ...defaultTacticalPlan(), ...over });

describe('familiarity grows with repetition', () => {
  it('improves the shape a side keeps training and playing', () => {
    let familiarity = emptyClubFamiliarity();
    const system = plan({ formation: 'F_4_3_3' });
    const values: number[] = [];
    for (let week = 0; week < 8; week += 1) {
      familiarity = progressFamiliarity({
        familiarity,
        playerFamiliarity: {},
        training: training({ primaryFocus: 'FORMATION_FAMILIARITY', secondaryFocus: 'RECOVERY' }),
        plan: system,
        playedPlan: system,
        startersThisWeek: [],
        startersLastWeek: [],
      }).familiarity;
      values.push(familiarity.FORMATION.F_4_3_3 ?? 0);
    }
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
    expect(values.at(-1)).toBeGreaterThan(70);
  });

  it('lets an unused system fade while the one being played grows', () => {
    let familiarity = emptyClubFamiliarity();
    familiarity.FORMATION.F_3_5_2 = 80;
    const system = plan({ formation: 'F_4_3_3' });
    for (let week = 0; week < 6; week += 1) {
      familiarity = progressFamiliarity({
        familiarity, playerFamiliarity: {}, training: training(),
        plan: system, playedPlan: system, startersThisWeek: [], startersLastWeek: [],
      }).familiarity;
    }
    // The shape they have stopped using slips; the one they play improves.
    // Six weeks is not enough to overtake a long-drilled system, and should not be.
    expect(familiarity.FORMATION.F_3_5_2!).toBeLessThan(80);
    expect(familiarity.FORMATION.F_4_3_3!).toBeGreaterThan(UNTRAINED_FAMILIARITY + 15);
  });

  it('builds role and position familiarity for players who keep playing there', () => {
    let playerFamiliarity = {};
    const starters = [{ playerId: 'p1', role: 'BOX_TO_BOX' as const, position: 'MC' as const }];
    for (let week = 0; week < 5; week += 1) {
      playerFamiliarity = progressFamiliarity({
        familiarity: emptyClubFamiliarity(), playerFamiliarity, training: training(),
        plan: plan(), playedPlan: plan(), startersThisWeek: starters, startersLastWeek: ['p1'],
      }).playerFamiliarity;
    }
    const entry = (playerFamiliarity as Record<string, { roles: Record<string, number>; positions: Record<string, number> }>).p1;
    expect(entry.roles.BOX_TO_BOX).toBeGreaterThan(UNTRAINED_FAMILIARITY + 10);
    expect(entry.positions.MC).toBeGreaterThan(UNTRAINED_FAMILIARITY + 10);
  });

  it('rewards a settled eleven and punishes wholesale changes', () => {
    const starters = Array.from({ length: 11 }, (_, i) => ({
      playerId: `p${i}`, role: 'CENTRAL_MIDFIELDER' as const, position: 'MC' as const,
    }));
    const settled = progressFamiliarity({
      familiarity: emptyClubFamiliarity(), playerFamiliarity: {}, training: training(),
      plan: plan(), playedPlan: null,
      startersThisWeek: starters,
      startersLastWeek: starters.map((s) => s.playerId),
    });
    const rotated = progressFamiliarity({
      familiarity: emptyClubFamiliarity(), playerFamiliarity: {}, training: training(),
      plan: plan(), playedPlan: null,
      startersThisWeek: starters,
      startersLastWeek: ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9', 'x10', 'x11'],
    });
    expect(settled.familiarity.OVERALL_STABILITY)
      .toBeGreaterThan(rotated.familiarity.OVERALL_STABILITY);
    expect(rotated.notes.join(' ')).toMatch(/unfamiliar with each other/);
  });

  it('only trains what the session actually covers', () => {
    const base = emptyClubFamiliarity();
    const system = plan({ pressing: 'HIGH', buildUp: 'SHORT_PASSING' });
    const pressed = progressFamiliarity({
      familiarity: base, playerFamiliarity: {},
      training: training({ primaryFocus: 'PRESSING', secondaryFocus: 'RECOVERY' }),
      plan: system, playedPlan: null, startersThisWeek: [], startersLastWeek: [],
    }).familiarity;
    expect(pressed.PRESSING.HIGH!).toBeGreaterThan(UNTRAINED_FAMILIARITY);
    // Build-up was not worked on, so it must not have improved.
    expect(pressed.BUILD_UP.SHORT_PASSING ?? UNTRAINED_FAMILIARITY)
      .toBeLessThanOrEqual(UNTRAINED_FAMILIARITY);
  });
});

describe('tactical change costs', () => {
  const drilled = wellDrilled(plan(), 78);

  it('treats no change as no cost', () => {
    const analysis = analyseTacticalChange(plan(), drilled, plan());
    expect(analysis.magnitude).toBe('NONE');
    expect(analysis.score).toBeLessThan(0.1);
  });

  it('prices a small dial adjustment as a minor change', () => {
    const next = plan({ defensiveLine: 'HIGH', tempo: 'FAST' });
    const analysis = analyseTacticalChange(next, drilled, plan());
    expect(['NONE', 'MINOR']).toContain(analysis.magnitude);
    expect(analysis.score).toBeLessThan(0.25);
  });

  it('prices a change of playing style as a moderate change', () => {
    const next = plan({ playingStyle: 'DIRECT', buildUp: 'DIRECT' });
    const analysis = analyseTacticalChange(next, drilled, plan());
    expect(analysis.magnitude).toBe('MODERATE');
  });

  it('prices changing formation, style and pressing at once as a major change', () => {
    const next = plan({ formation: 'F_3_5_2', playingStyle: 'DIRECT', pressing: 'INTENSE', defensiveApproach: 'AGGRESSIVE_PRESSING' });
    const analysis = analyseTacticalChange(next, drilled, plan());
    expect(analysis.magnitude).toBe('MAJOR');
    expect(analysis.simultaneousStructuralChange).toBe(true);
    expect(analysis.warnings.join(' ')).toMatch(/same week/);
  });

  it('costs more the further the shape moves', () => {
    const near = analyseTacticalChange(plan({ formation: 'F_4_2_3_1' }), drilled, plan({ formation: 'F_4_3_3' }));
    const far = analyseTacticalChange(plan({ formation: 'F_3_5_2' }), drilled, plan({ formation: 'F_4_3_3' }));
    const cost = (a: typeof near) => a.changes.find((c) => c.area === 'formation')?.cost ?? 0;
    expect(cost(far)).toBeGreaterThan(cost(near));
  });
});

describe('disruption is targeted, not generic', () => {
  it('a pressing change degrades pressing and leaves build-up alone', () => {
    const familiarity = wellDrilled(plan(), 78);
    const next = plan({ pressing: 'INTENSE' });
    const analysis = analyseTacticalChange(next, familiarity, plan());
    expect(analysis.disruption.pressingCoordination).toBeGreaterThan(0);
    expect(analysis.disruption.buildUpSecurity).toBe(0);
    expect(analysis.disruption.setPieceExecution).toBe(0);
  });

  it('a build-up change degrades build-up and leaves pressing alone', () => {
    const familiarity = wellDrilled(plan(), 78);
    const next = plan({ buildUp: 'LONG_DISTRIBUTION' });
    const analysis = analyseTacticalChange(next, familiarity, plan());
    expect(analysis.disruption.buildUpSecurity).toBeGreaterThan(0);
    expect(analysis.disruption.pressingCoordination).toBe(0);
  });

  it('a set-piece change degrades only set pieces', () => {
    const familiarity = wellDrilled(plan(), 78);
    const next = plan({ setPieceApproach: 'NEAR_POST' });
    const analysis = analyseTacticalChange(next, familiarity, plan());
    const channels = Object.entries(analysis.disruption)
      .filter(([, value]) => value > 0)
      .map(([channel]) => channel);
    expect(channels).toEqual(['setPieceExecution']);
  });

  it('feeds each execution channel from its own dimension', () => {
    const base = emptyClubFamiliarity();
    const system = plan();
    const noChange = analyseTacticalChange(system, base, system);

    const pressOnly: ClubFamiliarity = { ...wellDrilled(system, 30), PRESSING: { [system.pressing]: 95 } };
    const buildOnly: ClubFamiliarity = { ...wellDrilled(system, 30), BUILD_UP: { [system.buildUp]: 95 } };

    const pressModifiers = executionModifiers(pressOnly, system, noChange, 30);
    const buildModifiers = executionModifiers(buildOnly, system, noChange, 30);

    expect(pressModifiers.pressingCoordination).toBeGreaterThan(buildModifiers.pressingCoordination);
    expect(buildModifiers.buildUpSecurity).toBeGreaterThan(pressModifiers.buildUpSecurity);
  });

  it('keeps every execution modifier inside a bounded band', () => {
    const extremes: ClubFamiliarity[] = [emptyClubFamiliarity(), wellDrilled(plan(), 99)];
    for (const familiarity of extremes) {
      const analysis = analyseTacticalChange(plan({ formation: 'F_5_3_2', playingStyle: 'HIGH_TEMPO' }), familiarity, plan());
      const modifiers = executionModifiers(familiarity, plan(), analysis, 99);
      for (const channel of Object.keys(modifiers) as ExecutionChannel[]) {
        expect(modifiers[channel]).toBeGreaterThanOrEqual(1 - EXECUTION_BAND - 1e-9);
        expect(modifiers[channel]).toBeLessThanOrEqual(1 + EXECUTION_BAND + 1e-9);
      }
    }
  });
});

describe('gradual transitions cost less than abrupt ones', () => {
  it('rehearsing a new shape for weeks before playing it reduces the disruption', () => {
    const current = plan({ formation: 'F_4_3_3' });
    const target = plan({ formation: 'F_3_5_2' });

    // Manager A switches on matchday with no preparation.
    const abrupt = wellDrilled(current, 78);
    const abruptAnalysis = analyseTacticalChange(target, abrupt, current);

    // Manager B nominates 3-5-2 in training for four weeks while still playing 4-3-3.
    let gradual = wellDrilled(current, 78);
    for (let week = 0; week < 4; week += 1) {
      gradual = progressFamiliarity({
        familiarity: gradual,
        playerFamiliarity: {},
        training: training({
          primaryFocus: 'FORMATION_FAMILIARITY',
          secondaryFocus: 'MATCH_PREPARATION',
          intensity: 'HIGH',
          targetFormation: 'F_3_5_2',
        }),
        plan: current,
        playedPlan: current,
        startersThisWeek: [],
        startersLastWeek: [],
      }).familiarity;
    }
    const gradualAnalysis = analyseTacticalChange(target, gradual, current);

    expect(gradual.FORMATION.F_3_5_2!).toBeGreaterThan(abrupt.FORMATION.F_3_5_2 ?? UNTRAINED_FAMILIARITY);
    expect(gradualAnalysis.score).toBeLessThan(abruptAnalysis.score);
    expect(gradualAnalysis.disruption.positionalQuality)
      .toBeLessThan(abruptAnalysis.disruption.positionalQuality);
    expect(gradualAnalysis.magnitude).not.toBe('MAJOR');
    expect(abruptAnalysis.magnitude).toBe('MAJOR');
  });

  it('changing one area a week is cheaper than changing everything at once', () => {
    const start = plan();
    const end = plan({ playingStyle: 'COUNTER_ATTACKING', pressing: 'LOW', defensiveApproach: 'LOW_BLOCK', defensiveLine: 'DEEP' });
    const familiarity = wellDrilled(start, 78);

    const allAtOnce = analyseTacticalChange(end, familiarity, start);

    let staged = familiarity;
    let previous = start;
    const steps: TacticalPlanInput[] = [
      plan({ playingStyle: 'COUNTER_ATTACKING' }),
      plan({ playingStyle: 'COUNTER_ATTACKING', pressing: 'LOW' }),
      plan({ playingStyle: 'COUNTER_ATTACKING', pressing: 'LOW', defensiveApproach: 'LOW_BLOCK' }),
      end,
    ];
    let worstStep = 0;
    for (const step of steps) {
      const analysis = analyseTacticalChange(step, staged, previous);
      worstStep = Math.max(worstStep, analysis.score);
      staged = progressFamiliarity({
        familiarity: staged, playerFamiliarity: {}, training: training({ primaryFocus: 'DEFENSIVE_ORGANISATION', secondaryFocus: 'TRANSITION_PLAY' }),
        plan: step, playedPlan: step, startersThisWeek: [], startersLastWeek: [],
      }).familiarity;
      previous = step;
    }
    expect(worstStep).toBeLessThan(allAtOnce.score);
  });
});

describe('familiarity is not a trump card', () => {
  it('cannot rescue a much weaker squad', () => {
    const weak = makeClub('fam-weak', 54, 'fw');
    const strong = makeClub('fam-strong', 74, 'fs');
    const system = plan();
    let weakWins = 0;
    let strongWins = 0;
    for (let i = 0; i < 200; i += 1) {
      const h = buildTeam(weak, 'HOME', { familiarity: wellDrilled(system, 99) });
      const a = buildTeam(strong, 'AWAY', { familiarity: emptyClubFamiliarity() });
      const result = simulateMatch({ fixtureId: 'f', seed: `unbeatable-${i}`, home: h.team, away: a.team });
      if (result.homeGoals > result.awayGoals) weakWins += 1;
      else if (result.homeGoals < result.awayGoals) strongWins += 1;
    }
    // Perfect familiarity plus home advantage must not overturn a big quality gap.
    expect(strongWins).toBeGreaterThan(weakWins);
  });

  it('still helps two otherwise identical sides', () => {
    const club = makeClub('fam-even', 66, 'fe');
    const system = plan();
    let drilledWins = 0;
    let rawWins = 0;
    for (let i = 0; i < 300; i += 1) {
      const h = buildTeam(club, 'HOME', { familiarity: wellDrilled(system, 95) });
      const a = buildTeam(club, 'AWAY', { familiarity: emptyClubFamiliarity() });
      const result = simulateMatch({ fixtureId: 'f', seed: `drilled-${i}`, home: h.team, away: a.team });
      if (result.homeGoals > result.awayGoals) drilledWins += 1;
      else if (result.homeGoals < result.awayGoals) rawWins += 1;
    }
    expect(drilledWins).toBeGreaterThan(rawWins);
  });

  it('leaves the well-drilled side beatable', () => {
    const club = makeClub('fam-beatable', 66, 'fb');
    const system = plan();
    let losses = 0;
    for (let i = 0; i < 200; i += 1) {
      const h = buildTeam(club, 'HOME', { familiarity: wellDrilled(system, 99) });
      const a = buildTeam(club, 'AWAY', { familiarity: emptyClubFamiliarity() });
      const result = simulateMatch({ fixtureId: 'f', seed: `beatable-${i}`, home: h.team, away: a.team });
      if (result.homeGoals < result.awayGoals) losses += 1;
    }
    expect(losses / 200).toBeGreaterThan(0.12);
  });
});

describe('familiarity reporting', () => {
  it('summarises a system into one stability number', () => {
    const system = plan();
    expect(overallTacticalStability(wellDrilled(system, 90), system))
      .toBeGreaterThan(overallTacticalStability(wellDrilled(system, 40), system));
  });

  it('reads the value for the exact settings chosen', () => {
    const familiarity = emptyClubFamiliarity();
    familiarity.PRESSING.HIGH = 88;
    familiarity.PRESSING.LOW = 20;
    expect(familiarityFor(familiarity, plan({ pressing: 'HIGH' })).pressing).toBe(88);
    expect(familiarityFor(familiarity, plan({ pressing: 'LOW' })).pressing).toBe(20);
  });

  it('averages the starters when reporting positional familiarity', () => {
    const map = {
      a: { roles: { BOX_TO_BOX: 80 }, positions: { MC: 80 } },
      b: { roles: { BOX_TO_BOX: 20 }, positions: { MC: 20 } },
    };
    const value = positionalFamiliarity(map, [
      { playerId: 'a', role: 'BOX_TO_BOX', position: 'MC' },
      { playerId: 'b', role: 'BOX_TO_BOX', position: 'MC' },
    ]);
    expect(value).toBeCloseTo(50, 0);
  });
});
