/**
 * Match-engine calibration harness.
 *
 * Runs a large sample of matches between generated squads and prints the
 * aggregate statistics, so engine changes can be checked against real football
 * distributions rather than intuition. Run with: npx tsx scripts/calibrate.ts
 */
import { simulateMatch } from '../src/engine/engine';
import { buildTeam, makeClub } from '../tests/helpers/factory';

const REPETITIONS = Number(process.env.REPS ?? 30);

const clubs = [
  makeClub('alpha', 72), makeClub('bravo', 68), makeClub('charlie', 64),
  makeClub('delta', 61), makeClub('echo', 58), makeClub('foxtrot', 55),
];

let n = 0;
const agg = {
  goals: 0, homeGoals: 0, awayGoals: 0, shots: 0, sot: 0, xg: 0, passes: 0,
  passPct: 0, fouls: 0, yellow: 0, red: 0, corners: 0, offsides: 0,
  possession: 0, saves: 0, events: 0, homeWin: 0, draw: 0, awayWin: 0,
  ratingSum: 0, ratingCount: 0,
};
const scores: Record<string, number> = {};

for (let i = 0; i < clubs.length; i += 1) {
  for (let j = 0; j < clubs.length; j += 1) {
    if (i === j) continue;
    for (let s = 0; s < REPETITIONS; s += 1) {
      const home = buildTeam(clubs[i], 'HOME');
      const away = buildTeam(clubs[j], 'AWAY');
      const r = simulateMatch({
        fixtureId: `f${i}-${j}-${s}`, seed: `seed-${i}-${j}-${s}`,
        home: home.team, away: away.team,
      });
      n += 1;
      agg.goals += r.homeGoals + r.awayGoals;
      agg.homeGoals += r.homeGoals;
      agg.awayGoals += r.awayGoals;
      if (r.homeGoals > r.awayGoals) agg.homeWin += 1;
      else if (r.homeGoals === r.awayGoals) agg.draw += 1;
      else agg.awayWin += 1;
      const key = `${r.homeGoals}-${r.awayGoals}`;
      scores[key] = (scores[key] ?? 0) + 1;
      for (const side of ['HOME', 'AWAY'] as const) {
        const st = r.stats[side];
        agg.shots += st.shots; agg.sot += st.shotsOnTarget; agg.xg += st.expectedGoals;
        agg.passes += st.passes;
        agg.passPct += st.passes ? st.passesCompleted / st.passes : 0;
        agg.fouls += st.fouls; agg.yellow += st.yellowCards; agg.red += st.redCards;
        agg.corners += st.corners; agg.offsides += st.offsides; agg.saves += st.saves;
      }
      agg.possession += r.stats.HOME.possession;
      agg.events += r.events.length;
      for (const p of r.performances) { agg.ratingSum += p.rating; agg.ratingCount += 1; }
    }
  }
}

const perTeam = (v: number) => (v / (n * 2)).toFixed(2);
const rows: Array<[string, string, string]> = [
  ['goals per match', (agg.goals / n).toFixed(2), '2.6 - 2.9'],
  ['home goals', (agg.homeGoals / n).toFixed(2), '1.4 - 1.6'],
  ['away goals', (agg.awayGoals / n).toFixed(2), '1.1 - 1.4'],
  ['home win %', ((agg.homeWin / n) * 100).toFixed(1), '42 - 48'],
  ['draw %', ((agg.draw / n) * 100).toFixed(1), '22 - 28'],
  ['away win %', ((agg.awayWin / n) * 100).toFixed(1), '26 - 34'],
  ['shots per team', perTeam(agg.shots), '11 - 14'],
  ['shots on target per team', perTeam(agg.sot), '4 - 5.5'],
  ['xG per team', perTeam(agg.xg), '1.1 - 1.6'],
  ['passes per team', perTeam(agg.passes), '380 - 520'],
  ['pass accuracy %', ((agg.passPct / (n * 2)) * 100).toFixed(1), '76 - 85'],
  ['fouls per team', perTeam(agg.fouls), '9 - 13'],
  ['yellow cards per team', perTeam(agg.yellow), '1.4 - 2.4'],
  ['red cards per team', perTeam(agg.red), '0.02 - 0.10'],
  ['corners per team', perTeam(agg.corners), '4 - 6'],
  ['offsides per team', perTeam(agg.offsides), '1.5 - 3'],
  ['saves per team', perTeam(agg.saves), '2.5 - 4'],
  ['home possession %', (agg.possession / n).toFixed(1), '49 - 53'],
  ['events per match', (agg.events / n).toFixed(0), '120 - 260'],
  ['mean player rating', (agg.ratingSum / agg.ratingCount).toFixed(2), '6.2 - 6.9'],
];

console.log(`sample: ${n} matches\n`);
console.log('metric'.padEnd(26) + 'value'.padStart(8) + '   realistic range');
console.log('-'.repeat(60));
for (const [label, value, range] of rows) {
  console.log(label.padEnd(26) + value.padStart(8) + '   ' + range);
}
const top = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log('\nmost common scores: ' + top.map(([k, v]) => `${k} (${((v / n) * 100).toFixed(1)}%)`).join(', '));
