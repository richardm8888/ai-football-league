import type { TableRow } from '../league/standings';
import { ordinal } from '../league/standings';
import type { MatchFacts, TeamFacts } from './match';

/**
 * The league-wide matchday report every manager receives.
 *
 * Everything here is public information, derived from simulation output. No
 * private plan, private conversation or hidden attribute reaches this object.
 */

export interface RoundupResult {
  fixtureId: string;
  homeClubId: string;
  awayClubId: string;
  homeName: string;
  awayName: string;
  homeGoals: number;
  awayGoals: number;
  homeFormation: string;
  awayFormation: string;
  homePossession: number;
  awayPossession: number;
  homeShots: number;
  awayShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  scorers: Array<{ side: 'HOME' | 'AWAY'; name: string; minute: number }>;
  redCards: Array<{ side: 'HOME' | 'AWAY'; name: string; minute: number }>;
  narrative: string;
}

export interface TopPerformer {
  playerId: string;
  name: string;
  clubName: string;
  rating: number;
  goals: number;
  assists: number;
  position: string;
}

export interface LeagueRoundup {
  matchdayNumber: number;
  results: RoundupResult[];
  table: Array<TableRow & { clubName: string }>;
  topPerformers: TopPerformer[];
  headlines: string[];
  publicInjuries: Array<{ playerName: string; clubName: string; note: string }>;
  suspensions: Array<{ playerName: string; clubName: string; matches: number }>;
  trends: LeagueTrends;
}

export interface ClubTrend {
  clubId: string;
  clubName: string;
  matchesPlayed: number;
  averagePossession: number;
  averagePressingRate: number;
  averageDirectness: number;
  averageTerritory: number;
  goalsFromCounterAttacks: number;
  goalsFromSetPieces: number;
  goalsConcededFromCounterAttacks: number;
  goalsConcededFromSetPieces: number;
  formationsUsed: string[];
  formationChanges: number;
  averageShotsFor: number;
  averageShotsAgainst: number;
  cardsPerMatch: number;
}

export interface LeagueTrends {
  clubs: ClubTrend[];
  mostAggressivePress: string[];
  mostPossession: string[];
  mostDirect: string[];
  vulnerableToCounters: string[];
  mostRotatedShape: string[];
}

/** Roll every match a club has played into one public tactical fingerprint. */
export function buildClubTrends(
  facts: MatchFacts[], clubNames: Record<string, string>,
): LeagueTrends {
  const accumulator = new Map<string, ClubTrend & { possessionSum: number; pressSum: number; directSum: number; territorySum: number; shotsFor: number; shotsAgainst: number; cards: number; formations: Set<string> }>();

  const ensure = (clubId: string) => {
    let entry = accumulator.get(clubId);
    if (!entry) {
      entry = {
        clubId, clubName: clubNames[clubId] ?? clubId, matchesPlayed: 0,
        averagePossession: 0, averagePressingRate: 0, averageDirectness: 0, averageTerritory: 0,
        goalsFromCounterAttacks: 0, goalsFromSetPieces: 0,
        goalsConcededFromCounterAttacks: 0, goalsConcededFromSetPieces: 0,
        formationsUsed: [], formationChanges: 0, averageShotsFor: 0, averageShotsAgainst: 0,
        cardsPerMatch: 0,
        possessionSum: 0, pressSum: 0, directSum: 0, territorySum: 0,
        shotsFor: 0, shotsAgainst: 0, cards: 0, formations: new Set<string>(),
      };
      accumulator.set(clubId, entry);
    }
    return entry;
  };

  const record = (team: TeamFacts, opponent: TeamFacts) => {
    const entry = ensure(team.clubId);
    entry.matchesPlayed += 1;
    entry.possessionSum += team.possession;
    entry.pressSum += team.pressingRate;
    entry.directSum += team.directness;
    entry.territorySum += team.territory;
    entry.goalsFromCounterAttacks += team.counterAttackGoals;
    entry.goalsFromSetPieces += team.setPieceGoals;
    entry.goalsConcededFromCounterAttacks += opponent.counterAttackGoals;
    entry.goalsConcededFromSetPieces += opponent.setPieceGoals;
    entry.formations.add(team.formationLabel);
    entry.formationChanges += team.inMatchChanges;
    entry.shotsFor += team.shots;
    entry.shotsAgainst += opponent.shots;
    entry.cards += team.yellowCards + team.redCards;
  };

  for (const match of facts) {
    record(match.home, match.away);
    record(match.away, match.home);
  }

  const clubs: ClubTrend[] = [...accumulator.values()].map((e) => {
    const n = Math.max(1, e.matchesPlayed);
    return {
      clubId: e.clubId,
      clubName: e.clubName,
      matchesPlayed: e.matchesPlayed,
      averagePossession: Number((e.possessionSum / n).toFixed(1)),
      averagePressingRate: Number((e.pressSum / n).toFixed(3)),
      averageDirectness: Number((e.directSum / n).toFixed(3)),
      averageTerritory: Number((e.territorySum / n).toFixed(3)),
      goalsFromCounterAttacks: e.goalsFromCounterAttacks,
      goalsFromSetPieces: e.goalsFromSetPieces,
      goalsConcededFromCounterAttacks: e.goalsConcededFromCounterAttacks,
      goalsConcededFromSetPieces: e.goalsConcededFromSetPieces,
      formationsUsed: [...e.formations].sort(),
      formationChanges: e.formationChanges,
      averageShotsFor: Number((e.shotsFor / n).toFixed(1)),
      averageShotsAgainst: Number((e.shotsAgainst / n).toFixed(1)),
      cardsPerMatch: Number((e.cards / n).toFixed(2)),
    };
  });

  const top = (key: keyof ClubTrend, count = 3) => [...clubs]
    .sort((a, b) => Number(b[key]) - Number(a[key]))
    .slice(0, count)
    .map((c) => c.clubName);

  return {
    clubs: clubs.sort((a, b) => a.clubName.localeCompare(b.clubName)),
    mostAggressivePress: top('averagePressingRate'),
    mostPossession: top('averagePossession'),
    mostDirect: top('averageDirectness'),
    vulnerableToCounters: top('goalsConcededFromCounterAttacks'),
    mostRotatedShape: [...clubs]
      .sort((a, b) => b.formationsUsed.length - a.formationsUsed.length || b.formationChanges - a.formationChanges)
      .slice(0, 3)
      .map((c) => c.clubName),
  };
}

export interface RoundupInput {
  matchdayNumber: number;
  facts: MatchFacts[];
  table: Array<TableRow & { clubName: string }>;
  seasonFacts: MatchFacts[];
  clubNames: Record<string, string>;
  publicInjuries: LeagueRoundup['publicInjuries'];
  suspensions: LeagueRoundup['suspensions'];
}

export function buildLeagueRoundup(input: RoundupInput): LeagueRoundup {
  const results: RoundupResult[] = input.facts.map((m) => ({
    fixtureId: m.fixtureId,
    homeClubId: m.home.clubId,
    awayClubId: m.away.clubId,
    homeName: m.home.name,
    awayName: m.away.name,
    homeGoals: m.homeGoals,
    awayGoals: m.awayGoals,
    homeFormation: m.home.formationLabel,
    awayFormation: m.away.formationLabel,
    homePossession: m.home.possession,
    awayPossession: m.away.possession,
    homeShots: m.home.shots,
    awayShots: m.away.shots,
    homeShotsOnTarget: m.home.shotsOnTarget,
    awayShotsOnTarget: m.away.shotsOnTarget,
    homeExpectedGoals: m.home.expectedGoals,
    awayExpectedGoals: m.away.expectedGoals,
    scorers: [
      ...m.home.scorers.map((s) => ({ side: 'HOME' as const, name: s.name, minute: s.minute })),
      ...m.away.scorers.map((s) => ({ side: 'AWAY' as const, name: s.name, minute: s.minute })),
    ].sort((a, b) => a.minute - b.minute),
    redCards: [
      ...m.home.bookings.filter((b) => b.type === 'RED').map((b) => ({ side: 'HOME' as const, name: b.name, minute: b.minute })),
      ...m.away.bookings.filter((b) => b.type === 'RED').map((b) => ({ side: 'AWAY' as const, name: b.name, minute: b.minute })),
    ],
    narrative: '',
  }));

  const topPerformers: TopPerformer[] = input.facts
    .flatMap((m) => [
      ...m.home.topPerformers.map((p) => ({ ...p, clubName: m.home.name })),
      ...m.away.topPerformers.map((p) => ({ ...p, clubName: m.away.name })),
    ])
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 5);

  const headlines = buildHeadlines(input);

  return {
    matchdayNumber: input.matchdayNumber,
    results,
    table: input.table,
    topPerformers,
    headlines,
    publicInjuries: input.publicInjuries,
    suspensions: input.suspensions,
    trends: buildClubTrends(input.seasonFacts, input.clubNames),
  };
}

function buildHeadlines(input: RoundupInput): string[] {
  const headlines: string[] = [];
  const leader = input.table[0];
  if (leader) {
    const second = input.table[1];
    const gap = second ? leader.points - second.points : 0;
    headlines.push(
      gap > 0
        ? `${leader.clubName} lead the table on ${leader.points} points, ${gap} clear of ${second!.clubName}.`
        : `${leader.clubName} top the table on ${leader.points} points, level with ${second?.clubName ?? 'the chasing pack'} but ahead on goal difference.`);
  }

  const biggest = [...input.facts].sort(
    (a, b) => Math.abs(b.homeGoals - b.awayGoals) - Math.abs(a.homeGoals - a.awayGoals))[0];
  if (biggest && Math.abs(biggest.homeGoals - biggest.awayGoals) >= 3) {
    const winner = biggest.homeGoals > biggest.awayGoals ? biggest.home : biggest.away;
    const loser = winner === biggest.home ? biggest.away : biggest.home;
    headlines.push(`${winner.name} thrashed ${loser.name} ${Math.max(biggest.homeGoals, biggest.awayGoals)}-${Math.min(biggest.homeGoals, biggest.awayGoals)}.`);
  }

  const upset = input.facts.find((m) => {
    const winner = m.homeGoals > m.awayGoals ? m.home : m.awayGoals > m.homeGoals ? m.away : null;
    if (!winner) return false;
    const loser = winner === m.home ? m.away : m.home;
    return winner.expectedGoals + 0.8 < loser.expectedGoals;
  });
  if (upset) {
    const winner = upset.homeGoals > upset.awayGoals ? upset.home : upset.away;
    const loser = winner === upset.home ? upset.away : upset.home;
    headlines.push(`${winner.name} won despite being out-created: ${winner.expectedGoals} expected goals to ${loser.expectedGoals}.`);
  }

  const bottom = input.table[input.table.length - 1];
  if (bottom && bottom.played > 0) {
    headlines.push(`${bottom.clubName} sit ${ordinal(bottom.position)} with ${bottom.points} point${bottom.points === 1 ? '' : 's'} from ${bottom.played}.`);
  }
  return headlines;
}
