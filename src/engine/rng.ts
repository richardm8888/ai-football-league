/**
 * Deterministic pseudo-random numbers.
 *
 * The engine draws every random value from one of these, seeded from a string
 * stored with the match. Same seed plus same engine version plus same inputs
 * always reproduces the same match, which is what makes results auditable.
 */

/** xmur3: string -> 32-bit seed material. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number;
  /** True with the given probability. */
  chance(probability: number): boolean;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Approximately normal, clamped to +/- 3 sigma. */
  normal(mean: number, stdDev: number): number;
  /** Weighted pick. Weights need not sum to 1. */
  pick<T>(items: T[], weight: (item: T) => number): T;
  /** Uniform pick. */
  choice<T>(items: T[]): T;
}

export function createRng(seed: string): Rng {
  const seedFn = xmur3(seed);
  let a = seedFn();
  let b = seedFn();
  let c = seedFn();
  let d = seedFn();

  // sfc32: fast, well-distributed, and trivially reproducible across platforms.
  const next = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (probability) => next() < probability,
    normal(mean, stdDev) {
      // Irwin-Hall approximation: cheap, deterministic, no rejection loop.
      let sum = 0;
      for (let i = 0; i < 6; i += 1) sum += next();
      const z = (sum - 3) / Math.sqrt(0.5);
      return mean + Math.max(-3, Math.min(3, z)) * stdDev;
    },
    pick(items, weight) {
      const weights = items.map((item) => Math.max(0, weight(item)));
      const total = weights.reduce((x, y) => x + y, 0);
      if (total <= 0) return items[Math.floor(next() * items.length)];
      let roll = next() * total;
      for (let i = 0; i < items.length; i += 1) {
        roll -= weights[i];
        if (roll <= 0) return items[i];
      }
      return items[items.length - 1];
    },
    choice: (items) => items[Math.floor(next() * items.length)],
  };
  return rng;
}

/** A stable seed for a fixture, so re-running a matchday reproduces it exactly. */
export function fixtureSeed(seasonId: string, matchdayNumber: number, fixtureId: string): string {
  return `${seasonId}:${matchdayNumber}:${fixtureId}`;
}
