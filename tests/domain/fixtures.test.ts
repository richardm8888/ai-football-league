import { describe, expect, it } from 'vitest';
import { generateDoubleRoundRobin, matchdayCount } from '@/domain/generation/fixtures';

describe('double round-robin fixture generation', () => {
  for (const clubCount of [2, 4, 6, 8]) {
    describe(`${clubCount} clubs`, () => {
      const fixtures = generateDoubleRoundRobin(clubCount);

      it('plays every club against every other exactly twice', () => {
        const pairs = new Map<string, number>();
        for (const fixture of fixtures) {
          const key = [fixture.homeIndex, fixture.awayIndex].sort().join('-');
          pairs.set(key, (pairs.get(key) ?? 0) + 1);
        }
        const expectedPairs = (clubCount * (clubCount - 1)) / 2;
        expect(pairs.size).toBe(expectedPairs);
        for (const count of pairs.values()) expect(count).toBe(2);
      });

      it('gives every club one home and one away fixture against each opponent', () => {
        const seen = new Set<string>();
        for (const fixture of fixtures) {
          const key = `${fixture.homeIndex}>${fixture.awayIndex}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      });

      it('never schedules a club twice on the same matchday', () => {
        const byMatchday = new Map<number, Set<number>>();
        for (const fixture of fixtures) {
          const clubs = byMatchday.get(fixture.matchdayNumber) ?? new Set<number>();
          expect(clubs.has(fixture.homeIndex)).toBe(false);
          expect(clubs.has(fixture.awayIndex)).toBe(false);
          clubs.add(fixture.homeIndex);
          clubs.add(fixture.awayIndex);
          byMatchday.set(fixture.matchdayNumber, clubs);
        }
      });

      it('produces the expected number of matchdays', () => {
        const numbers = new Set(fixtures.map((f) => f.matchdayNumber));
        expect(numbers.size).toBe(matchdayCount(clubCount));
        expect(Math.max(...numbers)).toBe(matchdayCount(clubCount));
      });

      it('gives every club an even split of home and away fixtures', () => {
        for (let club = 0; club < clubCount; club += 1) {
          const home = fixtures.filter((f) => f.homeIndex === club).length;
          const away = fixtures.filter((f) => f.awayIndex === club).length;
          expect(home).toBe(clubCount - 1);
          expect(away).toBe(clubCount - 1);
        }
      });
    });
  }

  it('handles an odd number of clubs with a bye', () => {
    const fixtures = generateDoubleRoundRobin(7);
    for (let club = 0; club < 7; club += 1) {
      const appearances = fixtures.filter((f) => f.homeIndex === club || f.awayIndex === club);
      expect(appearances).toHaveLength(12);
    }
  });

  it('returns nothing for a league too small to play', () => {
    expect(generateDoubleRoundRobin(1)).toEqual([]);
  });
});
