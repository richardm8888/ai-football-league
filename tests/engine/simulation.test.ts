import { describe, expect, it } from 'vitest';
import { buildMatchFacts, narrateMatch } from '@/domain/reports/match';
import { defaultTacticalPlan } from '@/domain/tactics/selection';
import { ENGINE_VERSION, simulateMatch } from '@/engine/engine';
import { createRng, fixtureSeed } from '@/engine/rng';
import type { MatchResult } from '@/engine/types';
import { buildTeam, makeClub, wellDrilled } from '../helpers/factory';

const home = makeClub('home', 68, 'home-seed');
const away = makeClub('away', 66, 'away-seed');

function play(seed: string, options: {
  homeTactics?: Parameters<typeof buildTeam>[2];
  awayTactics?: Parameters<typeof buildTeam>[2];
} = {}): MatchResult {
  const h = buildTeam(home, 'HOME', options.homeTactics);
  const a = buildTeam(away, 'AWAY', options.awayTactics);
  return simulateMatch({ fixtureId: 'fixture', seed, home: h.team, away: a.team });
}

describe('determinism', () => {
  it('reproduces the same match exactly from the same seed and inputs', () => {
    const first = play('reproducible');
    const second = play('reproducible');
    expect(second.homeGoals).toBe(first.homeGoals);
    expect(second.awayGoals).toBe(first.awayGoals);
    expect(second.events).toEqual(first.events);
    expect(second.stats).toEqual(first.stats);
    expect(second.performances).toEqual(first.performances);
  });

  it('records the engine version so an old result stays attributable', () => {
    expect(play('versioned').engineVersion).toBe(ENGINE_VERSION);
  });

  it('builds a stable seed for a fixture', () => {
    expect(fixtureSeed('season', 3, 'fix')).toBe(fixtureSeed('season', 3, 'fix'));
    expect(fixtureSeed('season', 3, 'fix')).not.toBe(fixtureSeed('season', 4, 'fix'));
  });

  it('produces different matches from different seeds', () => {
    const results = ['a', 'b', 'c', 'd', 'e'].map((seed) => play(seed));
    const scores = new Set(results.map((r) => `${r.homeGoals}-${r.awayGoals}`));
    expect(scores.size).toBeGreaterThan(1);
  });

  it('gives the same stream of numbers for the same rng seed', () => {
    const a = createRng('x');
    const b = createRng('x');
    for (let i = 0; i < 50; i += 1) expect(b.next()).toBe(a.next());
  });
});

describe('statistical plausibility', () => {
  const sample = Array.from({ length: 120 }, (_, i) => play(`plausible-${i}`));
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

  it('scores a believable number of goals', () => {
    const goals = mean(sample.map((r) => r.homeGoals + r.awayGoals));
    expect(goals).toBeGreaterThan(2.2);
    expect(goals).toBeLessThan(3.4);
  });

  it('takes a believable number of shots, of which a plausible share are on target', () => {
    const shots = mean(sample.flatMap((r) => [r.stats.HOME.shots, r.stats.AWAY.shots]));
    const onTarget = mean(sample.flatMap((r) => [r.stats.HOME.shotsOnTarget, r.stats.AWAY.shotsOnTarget]));
    expect(shots).toBeGreaterThan(8);
    expect(shots).toBeLessThan(18);
    expect(onTarget / shots).toBeGreaterThan(0.25);
    expect(onTarget / shots).toBeLessThan(0.55);
  });

  it('keeps expected goals close to actual goals over a large sample', () => {
    const xg = mean(sample.flatMap((r) => [r.stats.HOME.expectedGoals, r.stats.AWAY.expectedGoals]));
    const goals = mean(sample.flatMap((r) => [r.homeGoals, r.awayGoals]));
    expect(Math.abs(xg - goals)).toBeLessThan(0.35);
  });

  it('splits possession between the two sides', () => {
    for (const result of sample) {
      expect(result.stats.HOME.possession + result.stats.AWAY.possession).toBeCloseTo(100, 0);
      expect(result.stats.HOME.possession).toBeGreaterThan(20);
      expect(result.stats.HOME.possession).toBeLessThan(80);
    }
  });

  it('produces plausible discipline and set-piece counts', () => {
    const fouls = mean(sample.flatMap((r) => [r.stats.HOME.fouls, r.stats.AWAY.fouls]));
    const yellows = mean(sample.flatMap((r) => [r.stats.HOME.yellowCards, r.stats.AWAY.yellowCards]));
    const reds = mean(sample.flatMap((r) => [r.stats.HOME.redCards, r.stats.AWAY.redCards]));
    const corners = mean(sample.flatMap((r) => [r.stats.HOME.corners, r.stats.AWAY.corners]));
    expect(fouls).toBeGreaterThan(7);
    expect(fouls).toBeLessThan(16);
    expect(yellows).toBeGreaterThan(1);
    expect(yellows).toBeLessThan(3);
    expect(reds).toBeLessThan(0.2);
    expect(corners).toBeGreaterThan(3);
    expect(corners).toBeLessThan(8);
  });

  it('never produces a nonsensical scoreline', () => {
    for (const result of sample) {
      expect(result.homeGoals).toBeGreaterThanOrEqual(0);
      expect(result.homeGoals).toBeLessThan(10);
      expect(result.stats.HOME.goals).toBe(result.homeGoals);
      expect(result.stats.AWAY.goals).toBe(result.awayGoals);
      expect(result.stats.HOME.shotsOnTarget).toBeGreaterThanOrEqual(result.homeGoals);
    }
  });

  it('gives every player who appeared a rating inside the scale', () => {
    for (const result of sample.slice(0, 20)) {
      for (const performance of result.performances) {
        expect(performance.minutesPlayed).toBeGreaterThan(0);
        expect(performance.rating).toBeGreaterThanOrEqual(1);
        expect(performance.rating).toBeLessThanOrEqual(10);
      }
    }
  });
});

describe('home advantage', () => {
  it('gives the home side a measurable but not decisive edge', () => {
    const balanced = makeClub('balanced', 65, 'balanced');
    let homeWins = 0;
    let awayWins = 0;
    let homeGoals = 0;
    let awayGoals = 0;
    for (let i = 0; i < 200; i += 1) {
      const h = buildTeam(balanced, 'HOME');
      const a = buildTeam(balanced, 'AWAY');
      const result = simulateMatch({ fixtureId: 'f', seed: `ha-${i}`, home: h.team, away: a.team });
      homeGoals += result.homeGoals;
      awayGoals += result.awayGoals;
      if (result.homeGoals > result.awayGoals) homeWins += 1;
      else if (result.homeGoals < result.awayGoals) awayWins += 1;
    }
    expect(homeWins).toBeGreaterThan(awayWins);
    expect(homeGoals).toBeGreaterThan(awayGoals);
    // An edge, not a guarantee: the away side must still win regularly.
    expect(awayWins / 200).toBeGreaterThan(0.18);
  });
});

describe('player quality', () => {
  /** The spread a private league actually generates: roughly 56 to 74. */
  function series(strongRating: number, weakRating: number, runs: number) {
    const strong = makeClub(`strong-${strongRating}`, strongRating, `s${strongRating}`);
    const weak = makeClub(`weak-${weakRating}`, weakRating, `w${weakRating}`);
    let strongWins = 0;
    let draws = 0;
    let weakWins = 0;
    for (let i = 0; i < runs; i += 1) {
      const h = buildTeam(strong, 'HOME');
      const a = buildTeam(weak, 'AWAY');
      const result = simulateMatch({ fixtureId: 'f', seed: `quality-${strongRating}-${i}`, home: h.team, away: a.team });
      if (result.homeGoals > result.awayGoals) strongWins += 1;
      else if (result.homeGoals === result.awayGoals) draws += 1;
      else weakWins += 1;
    }
    return { strongWins, draws, weakWins, runs };
  }

  it('makes the better squad the favourite', () => {
    const { strongWins, runs } = series(74, 56, 250);
    expect(strongWins / runs).toBeGreaterThan(0.6);
  });

  it('never makes the better squad a certainty', () => {
    const { strongWins, draws, weakWins, runs } = series(74, 56, 250);
    expect(strongWins / runs).toBeLessThan(0.93);
    // The weaker side must take points, whether by winning or holding on.
    expect(draws + weakWins).toBeGreaterThan(runs * 0.07);
    expect(weakWins).toBeGreaterThan(0);
  });

  it('leaves room for an upset even against a far stronger squad', () => {
    const { strongWins, runs } = series(84, 52, 400);
    expect(strongWins / runs).toBeGreaterThan(0.8);
    expect(strongWins).toBeLessThan(runs);
  });
});

describe('fitness and fatigue', () => {
  it('makes a tired squad measurably worse', () => {
    const fresh = makeClub('fresh', 66, 'fitness');
    const tiredPlayers = fresh.players.map((p) => ({ ...p, fitness: 48 }));
    let freshGoals = 0;
    let tiredGoals = 0;
    for (let i = 0; i < 120; i += 1) {
      const a = buildTeam(fresh, 'HOME');
      const b = buildTeam({ ...fresh, players: tiredPlayers }, 'AWAY');
      const result = simulateMatch({ fixtureId: 'f', seed: `tired-${i}`, home: a.team, away: b.team });
      freshGoals += result.homeGoals;
      tiredGoals += result.awayGoals;
    }
    expect(freshGoals).toBeGreaterThan(tiredGoals);
  });

  it('drains fitness over the ninety minutes', () => {
    const result = play('drain');
    const full = result.performances.filter((p) => p.minutesPlayed >= 85);
    expect(full.length).toBeGreaterThan(8);
    for (const performance of full) {
      expect(performance.endFitness).toBeLessThan(95);
      expect(performance.endFitness).toBeGreaterThan(30);
    }
  });
});

describe('tactical instructions change what happens', () => {
  const runs = 90;

  function averageStat(
    tactics: Partial<ReturnType<typeof defaultTacticalPlan>>,
    pick: (r: MatchResult) => number,
  ): number {
    let total = 0;
    for (let i = 0; i < runs; i += 1) {
      const plan = { ...defaultTacticalPlan(), ...tactics };
      const h = buildTeam(home, 'HOME', { tactics, familiarity: wellDrilled(plan) });
      const a = buildTeam(away, 'AWAY');
      total += pick(simulateMatch({ fixtureId: 'f', seed: `tactic-${i}`, home: h.team, away: a.team }));
    }
    return total / runs;
  }

  it('possession football keeps the ball more than direct football', () => {
    const possession = averageStat({ playingStyle: 'POSSESSION', buildUp: 'SHORT_PASSING' }, (r) => r.stats.HOME.possession);
    const direct = averageStat({ playingStyle: 'DIRECT', buildUp: 'LONG_DISTRIBUTION' }, (r) => r.stats.HOME.possession);
    expect(possession).toBeGreaterThan(direct + 4);
  });

  it('intense pressing produces more defensive actions than sitting off', () => {
    const intense = averageStat(
      { pressing: 'INTENSE', defensiveApproach: 'AGGRESSIVE_PRESSING', defensiveLine: 'HIGH' },
      (r) => r.stats.HOME.pressingActions + r.stats.HOME.tackles + r.stats.HOME.interceptions);
    const passive = averageStat(
      { pressing: 'LOW', defensiveApproach: 'LOW_BLOCK', defensiveLine: 'DEEP' },
      (r) => r.stats.HOME.pressingActions + r.stats.HOME.tackles + r.stats.HOME.interceptions);
    expect(intense).toBeGreaterThan(passive);
  });

  it('an attacking mentality creates more shots than a very defensive one', () => {
    const attacking = averageStat({ mentality: 'ATTACKING' }, (r) => r.stats.HOME.shots);
    const defensive = averageStat({ mentality: 'VERY_DEFENSIVE' }, (r) => r.stats.HOME.shots);
    expect(attacking).toBeGreaterThan(defensive + 1);
  });

  it('a very high line with an offside trap catches more players offside', () => {
    const trap = averageStat(
      { defensiveLine: 'VERY_HIGH', offsideTrap: true }, (r) => r.stats.AWAY.offsides);
    const deep = averageStat({ defensiveLine: 'DEEP' }, (r) => r.stats.AWAY.offsides);
    expect(trap).toBeGreaterThan(deep);
  });

  it('a low block concedes more territory than a high press', () => {
    const block = averageStat(
      { defensiveApproach: 'LOW_BLOCK', defensiveLine: 'DEEP', pressing: 'LOW' },
      (r) => r.stats.AWAY.possession);
    const press = averageStat(
      { defensiveApproach: 'AGGRESSIVE_PRESSING', defensiveLine: 'HIGH', pressing: 'HIGH' },
      (r) => r.stats.AWAY.possession);
    expect(block).toBeGreaterThan(press);
  });
});

describe('match events', () => {
  it('opens with kick-off, marks half time and closes with full time', () => {
    const result = play('events');
    expect(result.events[0].type).toBe('KICK_OFF');
    expect(result.events.at(-1)!.type).toBe('FULL_TIME');
    expect(result.events.some((e) => e.type === 'HALF_TIME')).toBe(true);
  });

  it('numbers events in order and keeps minutes inside the match', () => {
    const result = play('ordering');
    let previousSequence = 0;
    let previousMinute = 0;
    for (const event of result.events) {
      expect(event.sequence).toBeGreaterThan(previousSequence);
      expect(event.minute).toBeGreaterThanOrEqual(previousMinute - 1);
      expect(event.minute).toBeLessThanOrEqual(100);
      previousSequence = event.sequence;
      previousMinute = Math.max(previousMinute, event.minute);
    }
  });

  it('records exactly as many goal events as the scoreline', () => {
    for (let i = 0; i < 30; i += 1) {
      const result = play(`goal-count-${i}`);
      const homeGoalEvents = result.events.filter((e) => e.type === 'GOAL' && e.side === 'HOME');
      const awayGoalEvents = result.events.filter((e) => e.type === 'GOAL' && e.side === 'AWAY');
      expect(homeGoalEvents).toHaveLength(result.homeGoals);
      expect(awayGoalEvents).toHaveLength(result.awayGoals);
    }
  });

  it('attributes every goal to a player who was on the pitch', () => {
    for (let i = 0; i < 20; i += 1) {
      const result = play(`scorers-${i}`);
      const scorers = result.events.filter((e) => e.type === 'GOAL');
      for (const goal of scorers) {
        const performance = result.performances.find((p) => p.playerId === goal.playerId);
        expect(performance).toBeDefined();
        expect(performance!.goals).toBeGreaterThan(0);
      }
    }
  });

  it('makes planned substitutions at the planned time', () => {
    const h = buildTeam(home, 'HOME');
    const plannedOut = h.lineup.starters[9].playerId;
    const plannedIn = h.lineup.bench[1].playerId;
    const withSubs = buildTeam(home, 'HOME', {
      tactics: {
        substitutionPlan: [
          { outPlayerId: plannedOut, inPlayerId: plannedIn, minute: 60, condition: 'ALWAYS' },
        ],
      },
    });
    const a = buildTeam(away, 'AWAY');
    const result = simulateMatch({ fixtureId: 'f', seed: 'subs', home: withSubs.team, away: a.team });
    const substitution = result.events.find(
      (e) => e.type === 'SUBSTITUTION' && e.playerId === plannedIn);
    expect(substitution).toBeDefined();
    expect(substitution!.minute).toBe(60);
    expect(substitution!.secondaryPlayerId).toBe(plannedOut);
    const replacement = result.performances.find((p) => p.playerId === plannedIn);
    expect(replacement!.minutesPlayed).toBeGreaterThan(0);
    expect(replacement!.minutesPlayed).toBeLessThan(45);
  });

  it('applies a match-state instruction and records it', () => {
    const h = buildTeam(home, 'HOME', {
      tactics: {
        matchStateInstructions: [
          { trigger: 'AFTER_60', adjustment: 'MORE_ATTACKING', fromMinute: 60, note: '' },
        ],
      },
    });
    const a = buildTeam(away, 'AWAY');
    const result = simulateMatch({ fixtureId: 'f', seed: 'instruction', home: h.team, away: a.team });
    const change = result.events.find((e) => e.type === 'TACTICAL_CHANGE' && e.side === 'HOME');
    expect(change).toBeDefined();
    expect(change!.minute).toBeGreaterThanOrEqual(60);
    expect(result.stats.HOME.tacticalSummary.formationChanges).toBeGreaterThan(0);
  });

  it('takes a sent-off player out of the match', () => {
    for (let i = 0; i < 80; i += 1) {
      const result = play(`red-${i}`);
      const red = result.events.find((e) => e.type === 'RED_CARD');
      if (!red) continue;
      const performance = result.performances.find((p) => p.playerId === red.playerId);
      expect(performance!.redCard).toBe(true);
      expect(performance!.minutesPlayed).toBeLessThanOrEqual(red.minute + 2);
      return;
    }
  });
});

describe('reports reflect the simulation', () => {
  it('reproduces every number from the match data', () => {
    const result = play('report');
    const playerNames: Record<string, string> = {};
    const playerPositions: Record<string, string> = {};
    for (const player of [...home.players, ...away.players]) {
      playerNames[player.id] = player.name;
      playerPositions[player.id] = player.primaryPosition;
    }
    const facts = buildMatchFacts(result, {
      clubs: {
        [home.clubId]: { id: home.clubId, name: home.name, shortName: home.shortName },
        [away.clubId]: { id: away.clubId, name: away.name, shortName: away.shortName },
      },
      playerNames,
      playerPositions,
      homeClubId: home.clubId,
      awayClubId: away.clubId,
      homeTactics: defaultTacticalPlan(),
      awayTactics: defaultTacticalPlan(),
    });

    expect(facts.homeGoals).toBe(result.homeGoals);
    expect(facts.awayGoals).toBe(result.awayGoals);
    expect(facts.home.shots).toBe(result.stats.HOME.shots);
    expect(facts.away.possession).toBe(result.stats.AWAY.possession);
    expect(facts.home.scorers).toHaveLength(result.homeGoals);
    expect(facts.away.scorers).toHaveLength(result.awayGoals);
    for (const scorer of facts.home.scorers) {
      expect(playerNames[scorer.playerId]).toBe(scorer.name);
    }

    const narrative = narrateMatch(facts);
    expect(narrative).toContain(`${result.homeGoals}-${result.awayGoals}`);
    expect(narrative).toContain(`${result.stats.HOME.shots}-${result.stats.AWAY.shots}`);
    for (const scorer of facts.home.scorers) expect(narrative).toContain(scorer.name);
  });
});
