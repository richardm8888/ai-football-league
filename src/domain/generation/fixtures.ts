/**
 * Double round-robin fixture generation.
 *
 * Uses the circle method, which guarantees every club plays every other club
 * exactly twice, once at home and once away, with one fixture per club per
 * matchday. An odd number of clubs is handled by a bye.
 */

export interface GeneratedFixture {
  matchdayNumber: number;
  homeIndex: number;
  awayIndex: number;
}

export function generateDoubleRoundRobin(clubCount: number): GeneratedFixture[] {
  if (clubCount < 2) return [];
  const indices = Array.from({ length: clubCount }, (_, i) => i);
  const hasBye = clubCount % 2 === 1;
  if (hasBye) indices.push(-1);

  const n = indices.length;
  const roundsPerHalf = n - 1;
  const half = n / 2;
  const fixtures: GeneratedFixture[] = [];
  let rotation = [...indices];

  for (let round = 0; round < roundsPerHalf; round += 1) {
    for (let i = 0; i < half; i += 1) {
      const a = rotation[i];
      const b = rotation[n - 1 - i];
      if (a === -1 || b === -1) continue;
      // Alternate home advantage round by round so it is evenly shared.
      const homeFirst = (round + i) % 2 === 0;
      const home = homeFirst ? a : b;
      const away = homeFirst ? b : a;
      fixtures.push({ matchdayNumber: round + 1, homeIndex: home, awayIndex: away });
      fixtures.push({ matchdayNumber: round + 1 + roundsPerHalf, homeIndex: away, awayIndex: home });
    }
    // Rotate all but the first entry.
    rotation = [rotation[0], rotation[n - 1], ...rotation.slice(1, n - 1)];
  }

  return fixtures.sort((a, b) =>
    a.matchdayNumber - b.matchdayNumber || a.homeIndex - b.homeIndex);
}

export function matchdayCount(clubCount: number): number {
  const n = clubCount % 2 === 1 ? clubCount + 1 : clubCount;
  return (n - 1) * 2;
}
